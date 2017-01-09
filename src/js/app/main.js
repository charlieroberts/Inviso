// Global imports (NPM)
import * as THREE from 'three';
import TWEEN from 'tween.js';
import OBJLoader from 'three-obj-loader';
import simplify from 'simplify-js';

// Components
import Renderer from './components/renderer';
import Camera from './components/camera';
import Light from './components/light';
import Controls from './components/controls';
import SoundObject from './components/soundobject'
import SoundTrajectory from './components/soundtrajectory'
import SoundZone from './components/soundzone';

// Helpers
import Geometry from './helpers/geometry';

// Model
import Texture from './model/texture';
import Model from './model/model';

// Managers
import Interaction from './managers/interaction';
import DatGUI from './managers/datGUI';

// data
import Config from './../data/config';

// Local vars for rStats
let rS, bS, glS, tS;

// This class instantiates and ties all of the components together, starts the loading process and renders the main loop
export default class Main {
  constructor(container) {
    OBJLoader(THREE);
    this.setupAudio();

    this.mouse = new THREE.Vector3();
    this.nonScaledMouse = new THREE.Vector3();
    this.ray = new THREE.Raycaster();
    this.walkingRay = new THREE.Raycaster();

    this.isMouseDown = false;
    this.isAddingTrajectory = false;
    this.isAddingObject = false;
    this.isEditingObject = false;

    this.activeObject = null;

    this.floor;
    this.counter = 1;
    this.movementSpeed = 5;
    this.increment = 0.01;
    this.direction = 1;

    this.audio;
    this.soundObjects = [];
    this.soundTrajectories = [];
    this.soundZones = [];

    this.loader;
    this.moveForward = 0, this.moveBackwards = 0;
    this.yawLeft = 0, this.yawRight = 0;
    this.rotationSpeed = 0.05;
    this.listenerMovementSpeed = 5;

    this.perspectiveView = false;
    this.keyPressed = false;

    this.unselectedConeColor = new THREE.Color(0x80FFE7);
    this.selectedConeColor = new THREE.Color(0xFFCCCC);
    this.interactiveCone = null, this.previousInteractiveCone = null;
    this.selectedConeColor, this.unselectedConeColor;
    this.placingCone = false;
    this.replacingCone = false;

    this.cameraPosition = new THREE.Vector3();

    this.ray.linePrecision = 10;

    // Set container property to container element
    this.container = container;

    // Start Three clock
    this.clock = new THREE.Clock();

    // Main scene creation
    this.scene = new THREE.Scene();

    // Add GridHelper
    const grid = new THREE.GridHelper(Config.grid.size, Config.grid.divisions);
    grid.position.y = -300;
    grid.material.opacity = 0.25;
    grid.material.transparent = true;
    this.scene.add(grid);

    // Add AxisHelper
    this.axisHelper = new THREE.AxisHelper(60);
    this.axisHelper.rotation.y += Math.PI;
    this.scene.add(this.axisHelper);

    // Add Plane
    const geometry = new THREE.PlaneGeometry(5000, 5000);
    const material = new THREE.MeshBasicMaterial( {color: 0xffffff, side: THREE.DoubleSide, visible: false} );
    this.floor = new THREE.Mesh( geometry, material );
    this.floor.rotation.x = Math.PI/2;
    this.scene.add(this.floor);

    // Get Device Pixel Ratio first for retina
    if (window.devicePixelRatio) {
      Config.dpr = window.devicePixelRatio;
    }

    // Main renderer instantiation
    this.renderer = new Renderer(this.scene, container);

    // Components instantiation
    this.camera = new Camera(this.renderer.threeRenderer);
    this.controls = new Controls(this.camera.threeCamera, container);
    this.light = new Light(this.scene);
    this.loader = new THREE.OBJLoader();

    // Create and place lights in scene
    const lights = ['ambient', 'directional'];
    for (let i = 0; i < lights.length; i++) {
      this.light.place(lights[i]);
    }

    // Create planar grid
    this.grid = new Geometry(this.scene);
    this.grid.make('plane')(5000, 5000);
    this.grid.place([0, 0, 0], [Math.PI/2, 0, 0]);

    this.trajectory = {
      scene: null,
      points: [],
      lines: [],
      lastPoint: new THREE.Vector3(),

      setScene: function(scene) {
        this.scene = scene;
      },

      beginAt: function(point) {
        this.lastPoint = point;
        this.points = [point];
      },

      addPoint: function(point) {
        if (this.scene === null) {
          console.log('scene not set');
          return;
        }

        const material = new THREE.LineBasicMaterial({
          linewidth: 2,
          color: 0x999999
        });

        const geometry = new THREE.Geometry();
        geometry.vertices.push(this.lastPoint, point);

        const line = new THREE.Line(geometry,material);

        this.lastPoint = point;
        this.points.push(point);
        this.lines.push(line);
        this.scene.add(line);
      },

      createObject: function() {
        const points = simplify(this.points, 10, true);
        let object;

        if (points.length >= 3) {
          object = new SoundTrajectory(points);
        }

        this.clear();

        if (this.scene && object)
          object.addToScene(this.scene);
        return object;
      },

      clear: function() {
        const scene = this.scene;

        this.lines.forEach(function(line) {
          scene.remove(line);
        });

        this.lines = [];
        this.points = [];
      }
    }

    this.zone = {
      scene: null,              //    the scene
      points: [],               //    points on path
      lines: [],                //    lines on the scene
      lastPoint: new THREE.Vector3(),

      setScene: function(scene) {
        this.scene = scene;
      },

      beginAt: function(point) {
        this.lastPoint = point;
        this.points = [point];
      },

      addPoint: function(point) {
        if (this.scene === null) {
          console.log('scene not set');
          return;
        }

        const material = new THREE.LineBasicMaterial({
          color: 0xff1169
        });

        const geometry = new THREE.Geometry();
        geometry.vertices.push(this.lastPoint, point);

        const line = new THREE.Line(geometry,material);

        this.lastPoint = point;
        this.points.push(point);
        this.lines.push(line);
        this.scene.add(line);
      },

      createObject: function(main) {
        // simplify points using algorithm from simplify.js
        // tolerance = 10 is a somewhat arbitrary number :-\
        const points = simplify(this.points, 10, true);
        let object;
        if (points.length >= 3) {
          object = new SoundZone(main, points);
        } else {
          object = new SoundObject(main);
        }

        this.clear();

        if (this.scene && object)
          object.addToScene(this.scene);
        return object;
      },

      clear: function() {
        const scene = this.scene;
        this.lines.forEach(function(line) {
          scene.remove(line);
        });
        this.lines = [];
        this.points = [];
      }
    }

    this.trajectory.setScene(this.scene);
    this.zone.setScene(this.scene);

    new Interaction(this, this.renderer.threeRenderer, this.scene, this.camera.threecamera, this.controls.threeControls);


    // Set up rStats if dev environment
    if(Config.isDev) {
      bS = new BrowserStats();
      glS = new glStats();
      tS = new threeStats(this.renderer.threeRenderer);

      rS = new rStats({
        CSSPath: './assets/css/',
        userTimingAPI: true,
        values: {
          frame: { caption: 'Total frame time (ms)', over: 16, average: true, avgMs: 100 },
          fps: { caption: 'Framerate (FPS)', below: 30 },
          calls: { caption: 'Calls (three.js)', over: 3000 },
          raf: { caption: 'Time since last rAF (ms)', average: true, avgMs: 100 },
          rstats: { caption: 'rStats update (ms)', average: true, avgMs: 100 },
          texture: { caption: 'GenTex', average: true, avgMs: 100 }
        },
        groups: [
          { caption: 'Framerate', values: [ 'fps', 'raf' ] },
          { caption: 'Frame Budget', values: [ 'frame', 'texture', 'setup', 'render' ] }
        ],
        fractions: [
          { base: 'frame', steps: [ 'texture', 'setup', 'render' ] }
        ],
        plugins: [bS, tS, glS]
      });
    }

    // Create user head
    const dummyHead = new Model(this.scene, this.loader);
    dummyHead.load();

    document.querySelector('#add-object-button').onclick = this.toggleAddObject.bind(this);

    new DatGUI(this)

    // Start render which does not wait for model fully loaded
    this.container.querySelector('#loading').style.display = 'none';
    this.render();
    Config.isLoaded = true;
  }

  render() {
    // Render rStats if Dev
    if(Config.isDev) {
      rS('frame').start();
      glS.start();

      rS('rAF').tick();
      rS('FPS').frame();

      rS('render').start();
    }

    // Call render function and pass in created scene and camera
    this.renderer.render(this.scene, this.camera.threeCamera);

    // rStats has finished determining render call now
    if(Config.isDev) {
      rS('render').end(); // render finished
      rS('frame').end(); // frame finished

      // Local rStats update
      rS('rStats').start();
      rS().update();
      rS('rStats').end();
    }

    // Delta time is sometimes needed for certain updates
    //const delta = this.clock.getDelta();

    // Call any vendor or module updates here
    TWEEN.update();
    this.controls.threeControls.update();

    if (this.controls.threeControls.getPolarAngle() > 0.4)
      this.perspectiveView = true;
    else
      this.perspectiveView = false;

    this.checkZones();
    this.updateDummyHead();

    for (const i in this.soundObjects){
      if (!this.isMouseDown || this.soundObjects[i] != this.activeObject) {
        if (this.soundObjects[i].type === 'SoundObject') this.soundObjects[i].followTrajectory();
      }
    }

    if ( this.activeObject ) document.getElementById('guis').style.display = 'block';
    else document.getElementById('guis').style.display = 'none';

    // RAF
    requestAnimationFrame(this.render.bind(this)); // Bind the main class instead of window object
  }

  setupAudio(){
    var a = {};
    this.audio = a;

    window.AudioContext = window.AudioContext || window.webkitAudioContext;

    a.context = new AudioContext();
    a.context.listener.setOrientation(0, 0, -1, 0, 1, 0);
    a.context.listener.setPosition(0, 0, 1);
    a.destination = a.context.createGain();
    a.destination.connect(a.context.destination);
  }

  setListenerPosition(object) {
    var q = new THREE.Vector3();
    object.updateMatrixWorld();
    q.setFromMatrixPosition(object.matrixWorld);
    this.audio.context.listener.setPosition(q.x, q.y, q.z);

    var m = object.matrix;
    var mx = m.elements[12], my = m.elements[13], mz = m.elements[14];
    m.elements[12] = m.elements[13] = m.elements[14] = 0;

    var vec = new THREE.Vector3(0,0,-1);
    vec.applyProjection(m);
    vec.normalize();

    var up = new THREE.Vector3(0,-1,0);
    up.applyProjection(m);
    up.normalize();

    this.audio.context.listener.setOrientation(vec.x, vec.y, vec.z, up.x, up.y, up.z);

    m.elements[12] = mx;
    m.elements[13] = my;
    m.elements[14] = mz;
  }

  checkZones() {
    if( this.soundZones.length > 0 ){
      const walkingRayVector = new THREE.Vector3(0, -1, 0);
      this.walkingRay.set(this.head.position, walkingRayVector);

      for(const i in this.soundZones){
        const intersects = this.walkingRay.intersectObject( this.soundZones[i].shape );
        if (intersects.length > 0) {
          this.soundZones[i].underUser();
        } else {
          this.soundZones[i].notUnderUser();
        }
      }
    }
  }

  loadFile() {
    document.getElementById("soundPicker").click();
  }

  attach() {
    const SOUNDSPATH = 'assets/sounds/';

    const x = document.getElementById("soundPicker");
    if ( this.activeObject.type === 'SoundObject' ){ this.activeObject.createCone(SOUNDSPATH + x.files[0].name); }
    if ( this.activeObject.type === 'SoundZone' ){ this.activeObject.loadSound(SOUNDSPATH + x.files[0].name); }
    if ( this.activeObject.type === 'SoundTrajectory' ) this.activeObject.parentSoundObject.createCone(SOUNDSPATH + x.files[0].name);

    if(!this.isEditingObject){
      this.isEditingObject = true;
      this.cameraPosition.lerpVectors(this.activeObject.containerObject.position, this.head.position,
        500 / this.head.position.distanceTo(this.activeObject.containerObject.position));

      new TWEEN.Tween(this.camera.threeCamera.position)
        .to(this.cameraPosition, 800)
        .onComplete(() => {
          this.head.position.copy(this.cameraPosition);
          this.head.lookAt(this.activeObject.containerObject.position);
          this.axisHelper.position.copy(this.cameraPosition);
          this.axisHelper.lookAt(this.activeObject.containerObject.position);})
        .start();

      new TWEEN.Tween(this.controls.threeControls.center)
        .to(this.activeObject.containerObject.position, 800)
        .start();
    }
  }

  editObject() {
    if(!this.isEditingObject){
      this.cameraPosition.lerpVectors(this.activeObject.containerObject.position, this.head.position,
        500 / this.head.position.distanceTo(this.activeObject.containerObject.position));

      new TWEEN.Tween(this.camera.threeCamera.position)
        .to(this.cameraPosition, 800)
        .onComplete(() => {
          this.head.position.copy(this.cameraPosition);
          this.head.lookAt(this.activeObject.containerObject.position);
          this.axisHelper.position.copy(this.cameraPosition);
          this.axisHelper.lookAt(this.activeObject.containerObject.position);})
        .start();

      new TWEEN.Tween(this.controls.threeControls.center)
        .to(this.activeObject.containerObject.position, 800)
        .start();
    }

    this.isEditingObject = !this.isEditingObject;
  }

  toggleAddTrajectory() {
    if (this.perspectiveView) this.controls.threeContorls.reset();
    this.isAddingTrajectory = !this.isAddingTrajectory;
  }

  toggleAddObject() {
    if (this.perspectiveView) this.controls.threeControls.reset();
    this.isAddingObject = !this.isAddingObject;
  }

  setActiveObject(obj) {
    if (this.activeObject) {
      this.activeObject.setInactive();
    }

    this.activeObject = obj;

    console.log(this.activeObject);

    if (obj) {
      obj.setActive(this);
    }
  }

  updateDummyHead() {
    this.head = this.scene.getObjectByName('dummyHead', true);

    if (this.head){
      this.axisHelper.rotation.y += -this.yawLeft + this.yawRight;
      this.head.rotation.y += -this.yawLeft + this.yawRight;
      this.axisHelper.translateZ( -this.moveBackwards + this.moveForward);
      this.head.translateZ( -this.moveBackwards + this.moveForward);
      this.setListenerPosition(this.head);
    }
  }

  setMousePosition(event) {
    const pointer = new THREE.Vector3();
    pointer.set((event.clientX / window.innerWidth) * 2 - 1, -(event.clientY / window.innerHeight) * 2 + 1);

    this.nonScaledMouse = pointer;

    this.ray.setFromCamera(pointer, this.camera.threeCamera);

    const intersects = this.ray.intersectObject(this.floor);
    if (intersects.length > 0) {
      this.mouse = intersects[0].point;
    }
  }

  removeSoundZone(soundZone) {
    const i = this.soundZones.indexOf(soundZone);
    this.soundZones[i].notUnderUser();
    soundZone.removeFromScene(this.scene);
    this.soundZones.splice(i, 1);
  }

  removeSoundObject(soundObject) {
    soundObject.removeFromScene(this.scene);
    const i = this.soundObjects.indexOf(soundObject);
    this.soundObjects.splice(i, 1);
  }

  removeSoundTrajectory(soundTrajectory) {
    soundTrajectory.removeFromScene(this.scene);
    const i = this.soundTrajectories.indexOf(soundTrajectory);
    this.soundTrajectories.splice(i, 1);
  }
}
