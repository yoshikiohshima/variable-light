class LightActor {
    setup() {
        if (!this._cardData.colorA) {
            // this._cardData.colorA = [0x6f, 0xdb, 0xd9];
            this._cardData.colorA = [0x00, 0x00, 0xff];
        }
        if (!this._cardData.colorB) {
            // this._cardData.colorB = [0x8c, 0x5a, 0x56];
            this._cardData.colorB = [0xff, 0x00, 0x00];
        }
        if (!this.ratio) {
            this.ratio = 0;
            this.nextDirection = "toB";
            let c = this._cardData.colorA;
            this.currentColor = ((c[0] << 16) & 0xff0000) | ((c[1] << 8) & 0xff00) | (c[2] & 0xff);
        }

        this.subscribe("light", "trigger", "trigger");
    }

    trigger() {
        if (this.changing) {
            this.changing = false;
            this.nextDirection = this.nextDirection === "toA" ? "toB" : "toA";
            return;
        }
        this.changing = true;
        if (this.nextDirection === "toA") {
            this.toA();
        } else {
            this.toB();
        }
    }

    toA() {
        let duration = this._cardData.duration || 1.6;
        let steps = duration / 0.05;
        let by = 1 / steps;
        this.updateLightBy(-by);
        if (this.changing) {
            this.future(50).toA();
        }
    }

    toB() {
        let duration = this._cardData.duration || 1.6;
        let steps = duration / 0.05;
        let by = 1 / steps;
        this.updateLightBy(by);
        if (this.changing) {
            this.future(50).toB();
        }
    }

    updateLightBy(ratio) {
        this.ratio += ratio;
        this.ratio = Math.min(1, Math.max(0, this.ratio));
        if (this.ratio >= 1) {
            this.ratio = 1;
            this.changing = false;
            this.nextDirection = "toA";
        } else if (this.ratio <= 0) {
            this.ratio = 0;
            this.changing = false;
            this.nextDirection = "toB";
        }

        let a = this._cardData.colorA;
        let b = this._cardData.colorB;
        let c = Microverse.v3_lerp(a, b, this.ratio);

        this.currentColor = ((c[0] << 16) & 0xff0000) | ((c[1] << 8) & 0xff00) | (c[2] & 0xff);
        this.say("changeLight", this.currentColor);
    }
}

class LightPawn {
    setup() {
        let trm = this.service("ThreeRenderManager");
        let scene =  trm.scene;
        let camera = trm.camera;
        let group = this.shape;

        this.removeLights();
        this.lights = [];

        this.setupCSM(scene, camera, Microverse.THREE);

        let c = this.actor.currentColor;

        const ambient = new Microverse.THREE.AmbientLight( c || 0xffffff, .5 );
        group.add(ambient);
        this.lights.push(ambient);

        this.constructBackground(this.actor._cardData);

        let moduleName = this._behavior.module.externalName;
        this.addUpdateRequest([`${moduleName}$LightPawn`, "update"]);

        this.listen("updateShape", "updateShape");
        this.listen("changeLight", "changeLight");
    }

    changeLight(hex) {
        if (this.lights && this.lights[0] && this.lights[0].isAmbientLight) {
            this.lights[0].color = new Microverse.THREE.Color(hex);
        }
    }

    removeLights() {
        if (this.lights) {
            [...this.lights].forEach((light) => {
                light.dispose();
                this.shape.remove(light);
            });
        }
        delete this.lights;

        if (this.csm) {
            this.csm.remove();
            this.csm.dispose();
            delete this.csm;
        }
    }

    teardown() {
        console.log("teardown lights");
        this.removeLights();
        let scene = this.service("ThreeRenderManager").scene;
        scene.background?.dispose();
        scene.environment?.dispose();
        scene.background = null;
        scene.environment = null;

    }

    updateShape(options) {
        this.constructBackground(options);
    }

    constructBackground(options) {
        let assetManager = this.service("AssetManager").assetManager;
        let dataType = options.dataType;
        if (!options.dataLocation) {return;}
        return this.getBuffer(options.dataLocation).then((buffer) => {
            return assetManager.load(buffer, dataType, Microverse.THREE, options).then((texture) => {
                let TRM = this.service("ThreeRenderManager");
                let renderer = TRM.renderer;
                let scene = TRM.scene;
                let pmremGenerator = new Microverse.THREE.PMREMGenerator(renderer);
                pmremGenerator.compileEquirectangularShader();

                let exrCubeRenderTarget = pmremGenerator.fromEquirectangular(texture);
                let exrBackground = exrCubeRenderTarget.texture;

                let bg = scene.background;
                let e = scene.environment;
                scene.background = exrBackground;
                scene.environment = exrBackground;
                if(e !== bg) if(bg) bg.dispose();
                if(e) e.dispose();
                texture.dispose();
                if (this.actor._cardData.loadSynchronously) {
                    this.publish(this.sessionId, "synchronousCardLoaded", {id: this.actor.id});
                }
            });
        });
    }

    setupCSM(scene, camera, THREE) {
        if (this.csm) {
            this.csm.remove();
            this.csm.dispose();
            this.csm = null;
        }

        let dir = new THREE.Vector3(-2,-2,-0.5);
        this.csm = new THREE.CSM({
            fade: true,
            far: camera.far,
            maxFar: 1000,
            cascades: 3,
            shadowMapSize: 2048,
            shadowbias: 0.00025,
            lightDirection: dir,
            camera: camera,
            parent: scene,
            lightIntensity: 0.6,
            lightFar: 1000,
            mode: "practical"
        });
        this.csm.update();
    }

    update(_time) {
        if(this.csm) this.csm.update();
    }
}

class LightChangerPawn {
    setup() {
        [...this.shape.children].forEach((c) => this.shape.remove(c));

        let s = 0.2;
        let geometry = new Microverse.THREE.BoxGeometry(s, s, s);
        let material = new Microverse.THREE.MeshStandardMaterial({color: this.actor._cardData.color || 0xcccccc});
        this.obj = new Microverse.THREE.Mesh(geometry, material);
        this.obj.castShadow = this.actor._cardData.shadow;
        this.obj.receiveShadow = this.actor._cardData.shadow;
        this.shape.add(this.obj);

        this.addEventListener("pointerTap", () => this.publish("light", "trigger"));
    }
}

export default {
    modules: [
        {
            name: "Light",
            actorBehaviors: [LightActor],
            pawnBehaviors: [LightPawn]
        },
        {
            name: "LightChanger",
            pawnBehaviors: [LightChangerPawn]
        }
    ]
}

/* globals Microverse */
