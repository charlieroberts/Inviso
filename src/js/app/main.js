import * as THREE from 'three';

// Components
import Renderer from './components/renderer';
import Camera from './components/camera';
import Light from './components/light';
import Controls from './components/controls';
import PathDrawer from './components/pathdrawer';

// Helpers
import Geometry from './helpers/geometry';

// Model
import Model from './model/model';

// Managers
import Interaction from './managers/interaction';
import GUIWindow from './managers/guiwindow';

// data
import Config from './../data/config';

import TWEEN from 'tween.js';
import OBJLoader from './../utils/objloader';
import Helpers from './../utils/helpers';

import firebase from 'firebase/app';
import "firebase/auth";
import "firebase/database";
import "firebase/storage";
import * as firebaseui from 'firebaseui'

// Local vars for rStats
let rS, bS, glS, tS;
const readFile = inputFile => {
  const temporaryFileReader = new FileReader();

  return new Promise((resolve, reject) => {
    temporaryFileReader.onerror = () => {
      temporaryFileReader.abort();
      reject(new DOMException("Problem parsing input file."));
    };

    temporaryFileReader.onload = () => {
      resolve(temporaryFileReader.result);
    };
    temporaryFileReader.readAsDataURL(inputFile);
  });
};
// This class instantiates and ties all of the components together
// starts the loading process and renders the main loop
export default class Main {
  constructor(container) {
    OBJLoader(THREE);
    this.overrideTriangulate();
    this.audioInit = false;
    this.user = null;
    this.authui = null;
    this.__setupAudio = this.setupAudio.bind( this );
    window.addEventListener( 'click', this.__setupAudio );
    //this.setupAudio();
    this.audioFiles = [];

    this.mouse = new THREE.Vector3();
    this.nonScaledMouse = new THREE.Vector3();
    this.ray = new THREE.Raycaster();
    this.walkingRay = new THREE.Raycaster();

    this.isMuted = false;
    this.isMouseDown = false;
    this.isAddingTrajectory = false;
    this.isAddingObject = false;
    this.isEditingObject = false;
    this.isUserStudyLoading = false;

    this.activeObject = null;

    this.floor;
    this.counter = 1;
    this.movementSpeed = 10;
    this.increment = 0.01;
    this.direction = 1;

    this.soundObjects = [];
    this.soundTrajectories = [];
    this.soundZones = [];

    this.loader;
    this.moveForward = 0;
    this.moveBackwards = 0;
    this.yawLeft = 0;
    this.yawRight = 0;
    this.rotationSpeed = 0.05;

    this.perspectiveView = false;
    this.keyPressed = false;

    this.interactiveCone = null;

    this.cameraDestination = new THREE.Vector3();

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

    /**
     * The X-Z raycasting plane for determining where on the floor
     * the user is clicking.
     */
    const planeGeometry = new THREE.PlaneGeometry(Config.grid.size*2, Config.grid.size*2);
    const planeMaterial = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      side: THREE.BackSide,
      visible: false
    });
    this.floor = new THREE.Mesh(planeGeometry, planeMaterial);
    this.floor.rotation.x = Math.PI / 2;
    this.scene.add(this.floor);

    const shadowFloor = new THREE.Mesh(planeGeometry.clone(), new THREE.MeshLambertMaterial({
      color:0xf0f0f0,
      side:THREE.BackSide,
      transparent: true,
      opacity: 0.2
    }) );
    shadowFloor.rotation.x = Math.PI / 2;
    shadowFloor.position.y = -300;
    shadowFloor.receiveShadow = true;
    this.scene.add(shadowFloor);


    // Get Device Pixel Ratio first for retina
    if (window.devicePixelRatio) {
      Config.dpr = window.devicePixelRatio;
    }

    // Main renderer instantiation
    this.renderer = new Renderer(this.scene, container);

    // Components instantiation
    this.camera = new Camera(this.renderer.threeRenderer);
    this.controls = new Controls(this.camera.threeCamera, document);
    this.loader = new THREE.OBJLoader();
    this.light = new Light(this.scene);

    // Create and place lights in scene
    ['ambient', 'directional'].forEach(l => this.light.place(l));

    /**
     * Setting up interface to create object/zone/trajectory instances.
     */
    this.path = new PathDrawer(this.scene);

    this.interactionManager = new Interaction(this, this.renderer.threeRenderer, this.scene, this.camera.threecamera, this.controls.threeControls);

    // Set up rStats if dev environment
    if(Config.isDev) {
      bS = new BrowserStats();
      glS = new glStats();
      tS = new threeStats(this.renderer.threeRenderer);

      rS = new rStats({
        CSSPath: './assets/css/',
        userTimingAPI: false,
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

    // AxisHelper for the Head Model
    this.axisHelper = new THREE.AxisHelper(60);
    this.axisHelper.rotation.y += Math.PI;
    this.scene.add(this.axisHelper);

    // ui elements
    document.getElementById('add-object-button').onclick = this.toggleAddObject.bind(this);
    var self = this;
    document.getElementById('mute-button').onclick = function() {
      self.toggleGlobalMute();
      this.style.display = 'none';
      document.getElementById('unmute-button').style.display = 'block';
    }
    document.getElementById('unmute-button').onclick = function() {
      self.toggleGlobalMute();
      this.style.display = 'none';
      document.getElementById('mute-button').style.display = 'block';
    }

    const this_ = this;

    document.getElementById('login').onclick = this.login.bind( this );
    document.getElementById('save').onclick = function() {
      this.data = this_.export()/*.then((data) => {
        const a = document.createElement('a');
        a.href = data;
        a.download = 'export.zip';
        a.click();
      });*/
    }

    document.getElementById('load').onclick = this.import.bind( this )
    //document.getElementById('load').onclick = function() {
    //  const i = document.getElementById('import');
    //  i.click();
    //  i.addEventListener('change', handleFiles, false);

    //  function handleFiles() {
    //    this_.import(this.files[0]);
    //  }
    //}

    //this.cameraLabel = document.getElementById('camera-label');
    //this.cameraLabel.onclick = this.reset.bind(this);
    // this.cameraLabel.onclick = function (){
    //   document.getElementById('help-camera').style.display = 'none';
    // }
    //this.cameraLabel.innerHTML = this.perspectiveView ? 'Altitude view' : 'Aerial view';

    this.gui = new GUIWindow(this);

    // Start render which does not wait for model fully loaded
    this.container.querySelector('#loading').style.display = 'none';
    this.render();

    zip.workerScriptsPath = './assets/js/';

    this.zipHelper = (function() {
      var zipFileEntry,
        zipWriter,
        writer,
        URL = window.URL || window.webkitURL || window.mozURL;

      return {
        addFiles: (files, oninit, onadd, onprogress, onend) => {
          var addIndex = 0;

          function nextFile() {
            var file = files[addIndex];
            onadd(file);
            zipWriter.add(
              file.name,
              new zip.BlobReader(file),
              function() {
                addIndex++;
                if (addIndex < files.length) nextFile();
                else onend();
              },
              onprogress,
            );
          }

          function createZipWriter() {
            zip.createWriter(
              writer,
              function(writer) {
                zipWriter = writer;
                oninit();
                nextFile();
              },
              function(error) {
                console.log(error);
              },
            );
          }

          if (zipWriter) nextFile();
          writer = new zip.BlobWriter();
          createZipWriter();
        },

        getEntries: (file, onend) => {
          zip.createReader(new zip.BlobReader(file), (zipReader) => {
            zipReader.getEntries(onend);
          }, (error) => {
            console.log(error);
          });
        },

        getEntryFile: (entry, onend, onprogress) => {
          var writer, zipFileEntry;

          function getData() {
            entry.getData(writer, (blob) => {
              onend(entry.filename, blob);
            }, onprogress);
          }

          writer = new zip.BlobWriter();
          getData();
        },

        getBlobURL: (callback) => {
          zipWriter.close(function(blob) {
            var blobURL = URL.createObjectURL(blob);
            callback(blobURL);
            zipWriter = null;
          });
        },

        getBlob: (callback) => {
          zipWriter.close(callback);
        },
      };
    })();

    Config.isLoaded = true;

    this.initFirebase()
  }

  initFirebase() {
    const config = {
      apiKey: "AIzaSyBFFzD5c8fABhevN6FSW70biNNEj_cTvQI",
      authDomain: "bosear-test.firebaseapp.com",
      databaseURL: "https://bosear-test.firebaseio.com",
      storageBucket: "gs://bosear-test.appspot.com"
    };

    this.firebase = firebase.initializeApp(config);
    firebase.auth().signInAnonymously().catch( err => {
      console.log( err )
    })
    firebase.auth().onAuthStateChanged( user => {
      this.db = firebase.database();
      this.storageref = firebase.storage().ref()
      this.ref = this.db.ref('/sketches')
      this.ref.on('value', state => {
        //console.log( 'state:', state.val() )
      })
      //this.db.ref('/users').once('value').then( state => console.log( state.val() ) )
    })
  }

  login() {
    const app = this
    const auth = document.getElementById('auth')
    auth.style.display = 'block'

    this.interactionManager.active = false 
    var uiConfig = {
      callbacks: {
        signInSuccessWithAuthResult: function(authResult, redirectUrl) {
          app.interactionManager.active = true
          return false;
        }
      },
      credentialHelper: firebaseui.auth.CredentialHelper.NONE,
      signInOptions: [
        {
          provider:firebase.auth.EmailAuthProvider.PROVIDER_ID,
          requireDisplayName:false
        }
      ],
    }
    if( this.authui === null ) {
      this.authui = new firebaseui.auth.AuthUI(firebase.auth())
    }
    this.authui.start('#auth', uiConfig);
    firebase.auth().onAuthStateChanged( user => {
      if( user !== null && user.email !== null ) {
        console.log( user )
        this.user = {
          email: user.email,
          authenticated:true
        }
        auth.style.display = 'none'
        
        app.db.ref('/sketchesByUser').orderByChild( 'user' ).equalTo( user.email ).on( 'value', data => {
          this.user.files = data.val()
        })

        const loginBtn = document.getElementById('login')
        loginBtn.innerText = this.user.email + ' (logout)'
        loginBtn.onclick = ()=> {
          firebase.auth().signOut().then( ()=> {
            loginBtn.innerText = 'login'
            loginBtn.onclick = app.login.bind( app )
            app.user = null
          })
        }
      }
    })
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

    /* Frame rate dependency for the head movement speed */
    if(rS('FPS').value()) this.movementSpeed = 10 * (30 / rS('FPS').value());

    /* Camera tweening object update */
    TWEEN.update();

    /* Updating camera controls. */
    this.controls.threeControls.update();

    /**
     * Hands over the positioning of the listener node from the head model
     * to the camera in object edit view
     **/
    if(this.isEditingObject) this.setListenerPosition(this.camera.threeCamera);

    /**
     * Differentiating between perspective and bird's-eye views. If the camera is tilted
     * enough the perspective view is activated, restring user's placement of object in the
     * X-Z plane
     */
    if (this.controls.threeControls.getPolarAngle() > 0.4) {
      if (!this.perspectiveView) {
        document.getElementById('help-camera').style.display = 'none';
        this.perspectiveView = true;
        //this.cameraLabel.innerHTML = 'Altitude view';
      }
    } else if (this.perspectiveView) {
      this.perspectiveView = false;
      //this.cameraLabel.innerHTML = 'Aerial view';
    }

    /* Checking if the user has walked into a sound zone in each frame. */
    this.checkZones();

    /* Updating the head model's position and orientation in each frame. */
    this.updateDummyHead();

    /**
     * Stops an object trajectory motion if the used clicks onto a moving object
     */
    for (const i in this.soundObjects) {
      if (!this.isMouseDown || this.soundObjects[i] !== this.activeObject) {
        if (this.soundObjects[i].type === 'SoundObject') {
          this.soundObjects[i].followTrajectory(this.isMuted);
        }
      }
    }

    /* Making the GUI visible if an object is selected */
    this.gui.display(this.activeObject);

    requestAnimationFrame(this.render.bind(this)); // Bind the main class instead of window object
  }

  clear() {
    this.soundZones.forEach( zone => zone.removeFromScene( this.scene ) )
    this.soundZones.length = 0
    this.soundObjects.forEach( obj=> obj.removeFromScene( this.scene ) )
    this.soundObjects.length = 0
  }

  setupAudio() {
    const a = {};
    window.AudioContext = window.AudioContext || window.webkitAudioContext;

    a.context = new AudioContext();
    a.context.listener.setOrientation(0, 0, -1, 0, 1, 0);
    a.context.listener.setPosition(0, 1, 0);
    a.destination = a.context.createGain();
    a.destination.connect(a.context.destination);

    this.audio = a;
    this.audioInit = true

    window.removeEventListener( 'click', this.__setupAudio )
  }

  setListenerPosition(object) {
    const q = new THREE.Vector3();
    object.updateMatrixWorld();
    q.setFromMatrixPosition(object.matrixWorld);
    if( this.audioInit )
      this.audio.context.listener.setPosition(q.x, q.y, q.z);

    const m = object.matrix;
    const mx = m.elements[12];
    const my = m.elements[13];
    const mz = m.elements[14];
    m.elements[12] = m.elements[13] = m.elements[14] = 0;

    const vec = new THREE.Vector3(0, 0, -1);
    vec.applyMatrix4(m);
    vec.normalize();

    const up = new THREE.Vector3(0, -1, 0);
    up.applyMatrix4(m);
    up.normalize();

    if( this.audioInit ) 
      this.audio.context.listener.setOrientation(vec.x, vec.y, vec.z, up.x, up.y, up.z);

    m.elements[12] = mx;
    m.elements[13] = my;
    m.elements[14] = mz;
  }

  /**
   * Checks if the user has walked into a sound zone by raycasting from the
   * head model's position onto each sound zone into scene and checking if there
   * is a hit.
   */
  checkZones() {
    if( this.audioInit ) {
      if (this.soundZones.length > 0) {
        const walkingRayVector = new THREE.Vector3(0, -1, 0);
        this.walkingRay.set(this.head.position, walkingRayVector);

        for (const i in this.soundZones) {
          const intersects = this.walkingRay.intersectObject(this.soundZones[i].shape);
          if (intersects.length > 0) {
            /**
             * Flagging a zone "under user" to activate the audio file associated
             * with the sound zone.
             */
            this.soundZones[i].underUser(this.audio);
          } else {
            this.soundZones[i].notUnderUser(this.audio);
          }
        }
      }
    }
  }

  tweenToObjectView() {
    if (this.isEditingObject) {
      let vec = new THREE.Vector3().subVectors(this.camera.threeCamera.position, this.activeObject.containerObject.position);
      vec.y = this.activeObject.containerObject.position.y;
      this.cameraDestination = this.activeObject.containerObject.position.clone().addScaledVector(vec.normalize(), 500);

      new TWEEN.Tween(this.camera.threeCamera.position)
        .to(this.cameraDestination, 800)
        .start();

      new TWEEN.Tween(this.controls.threeControls.center)
        .to(this.activeObject.containerObject.position, 800)
        .start();

      /**
       * Edit Object View only applies to sound objects. A Sound Object in the scene
       * is represented with 4 elements: Raycast Sphere Mesh, AxisHelper,
       * AltitudeHelper Line, and the containerObject which holds the omniSphere
       * and the cones. To make only the activeObject and nothing else in the scene,
       * first we set every object after scene defaults (i.e. grid, collider plane,
       * lights, edit view light box and camera helper) invisible. Then we find the
       * index of the raycast sphere that belongs to the active object and make
       * this and the following 3 object visible to bring the activeObject back
       * in the scene.
       **/

      if (this.head) {
        this.head.visible = false;
        //this.head.children[0].material.opacity = 0.05;
        this.axisHelper.visible = false;
      }
      this.gui.disableGlobalParameters();
      [].concat(this.soundObjects, this.soundZones).forEach((object) => {
        if (object !== this.activeObject) {
          if (object.type === "SoundObject") {
            object.axisHelper.visible = false;
            object.altitudeHelper.visible = false;
            object.cones.forEach(cone => cone.material.opacity = 0.1);
            object.omniSphere.material.opacity = 0.2;
          }
          else if (object.type === "SoundZone") {
            object.shape.material.opacity = 0.05;
            // object.shape.visible = false;
          }
        }

        if (object.type === "SoundObject") {
          object.pause();
          if (object === this.activeObject) {
            object.axisHelper.visible = true;
            object.axisHelper.visible = true;
            object.altitudeHelper.visible = true;
            object.cones.forEach(cone => cone.material.opacity = 0.8);
            object.omniSphere.material.opacity = 0.8;
          }
        }
      });

      /* lightbox effect */
      this.renderer.threeRenderer.setClearColor(0xbbeeff);
    }
  }

  enterEditObjectView() {
    this.toggleAddTrajectory(false);
    //document.getElementById('camera-label').style.display = 'none';

    // disable panning in object view
    this.controls.disablePan();

    // slightly hacky fix: orbit controls tween works poorly from top view
    if (this.controls.threeControls.getPolarAngle() < 0.01) {
      this.controls.threeControls.constraint.rotateUp(-0.02);
      this.controls.threeControls.update();
    }

    if (!this.isEditingObject) {
      this.isEditingObject = true;
      this.isAddingObject = this.isAddingTrajectory = false;
      this.originalCameraPosition = this.camera.threeCamera.position.clone();
      this.originalCameraCenter = this.controls.threeControls.center.clone();
    }

    if (this.activeObject.type == 'SoundTrajectory') {
      // return control to parent sound object
      this.activeObject.deselectPoint();
      this.activeObject = this.activeObject.parentSoundObject;
    }

    this.tweenToObjectView();
  }

  exitEditObjectView(reset){
    //document.getElementById('camera-label').style.display = 'block';
    // re-enable panning
    this.controls.enablePan();

    if (this.gui.editor) { this.gui.exitEditorGui(); }
    this.isEditingObject = false;
    if (this.head) {
      this.head.visible = true;
      // this.head.children[0].material.opacity = 1;
      this.axisHelper.visible = true;
    }
    this.gui.enableGlobalParameters();
    [].concat(this.soundObjects, this.soundZones).forEach((object) => {
      if (object.type === "SoundObject") {
        object.axisHelper.visible = true;
        object.altitudeHelper.visible = true;
        object.cones.forEach(cone => cone.material.opacity = 0.8);
        object.omniSphere.material.opacity = 0.8;
        object.unpause();
      }
      else if (object.type === "SoundZone") {
        object.shape.material.opacity = Helpers.mapRange(object.volume, 0, 2, 0.05, 0.35);
        // object.shape.visible = true;
      }
    });

    if (!this.isAddingTrajectory && !this.isAddingObject && !reset) {
      new TWEEN.Tween(this.camera.threeCamera.position)
        .to(this.originalCameraPosition, 800)
        .start();

      new TWEEN.Tween(this.controls.threeControls.center)
        .to(this.originalCameraCenter, 800)
        .start();
    }
    /* turn off lightbox effect */
    this.renderer.threeRenderer.setClearColor(0xf0f0f0);
  }

  reset() {
    if (this.isEditingObject) {
      this.exitEditObjectView(true);
    }
    this.controls.threeControls.reset();
  }

  set audio(audio) {
    this._audio = audio;
  }

  get audio() {
    return this._audio;
  }

  /**
   * Sets the trajectory adding state on. If the scene is in perspective view when
   * this is called, it will be reset to bird's eye.
   */
  toggleAddTrajectory(state) {
    this.isAddingTrajectory = (state === undefined) ? !this.isAddingTrajectory : state;
    const trajectoryElement = document.getElementById('add-trajectory');
    if (trajectoryElement) {
      trajectoryElement.classList.toggle('active', this.isAddingTrajectory);
    }

    this.reset();
  }

  /**
   * Sets the object adding state on. If the scene is in perspective view when
   * this is called, it will be reset to bird's eye.
   */
  toggleAddObject() {
    this.isAddingObject = !this.isAddingObject;
    if (this.isAddingTrajectory) {
      this.toggleAddTrajectory(false);
    }
    this.reset();

    var btn = document.getElementById('add-object-button');
    btn.classList.toggle('active', this.isAddingObject);
    btn.innerHTML = this.isAddingObject ? '×' : '+';

    document.getElementById('help-add').style.display = 'none';
  }

  /**
   * Sets the the last clicked (active) object.
   * Calls a "secActive()" function ob the selected object.
   */
  setActiveObject(obj) {
    if (this.activeObject) {
      this.activeObject.setInactive();
    }

    this.activeObject = obj;

    if (obj) {
      if (obj.cones && obj.cones.length > 0) {
        this.interactiveCone = obj.cones[0];
      }
      obj.setActive(this);
    }
  }

  /* Updates the head model's position and orientation in each frame. */
  updateDummyHead() {
    this.head = this.scene.getObjectByName('dummyHead', true);

    if (this.head && !this.isEditingObject) {
      this.axisHelper.rotation.y += -this.yawLeft + this.yawRight;
      this.head.rotation.y += -this.yawLeft + this.yawRight;
      this.axisHelper.translateZ(-this.moveBackwards + this.moveForward);
      this.head.translateZ(-this.moveBackwards + this.moveForward);
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

  toggleGlobalMute() {
    this.isMuted = !this.isMuted;
    [].concat(this.soundObjects, this.soundZones).forEach(sound => sound.checkMuteState(this));
  }

  muteAll(excludedSounds) {
    var sounds = [].concat(this.soundObjects, this.soundZones);

    if (excludedSounds) {
      excludedSounds = [].concat(excludedSounds);
      sounds = sounds.filter(sound => excludedSounds.indexOf(sound) < 0);
    }

    sounds.forEach(sound => sound.mute(this));
  }

  unmuteAll(excludedSounds) {
    var sounds = [].concat(this.soundObjects, this.soundZones);

    if (excludedSounds) {
      excludedSounds = [].concat(excludedSounds);
      sounds = sounds.filter(sound => excludedSounds.indexOf(sound) < 0);
    }

    sounds.forEach(sound => sound.unmute(this));
  }

  removeSoundZone(soundZone) {
    const i = this.soundZones.indexOf(soundZone);
    this.soundZones[i].notUnderUser(this.audio);
    soundZone.removeFromScene(this.scene);
    this.soundZones.splice(i, 1);
  }

  removeSoundObject(soundObject) {
    soundObject.removeFromScene(this.scene);
    const i = this.soundObjects.indexOf(soundObject);
    this.soundObjects.splice(i, 1);
  }

  removeCone(object, cone) {
    object.removeCone(cone);
    this.gui.removeCone(cone);
  }

  removeSoundTrajectory(soundTrajectory) {
    soundTrajectory.removeFromScene(this.scene);
    const i = this.soundTrajectories.indexOf(soundTrajectory);
    this.soundTrajectories.splice(i, 1);
  }

  /**
  (didn't know where I should put this)

  overrides three.js triangulate with libtess.js algorithm for the conversion of a curve to a filled (2D) path. still doesn't produce desired behavior with some non-simple paths

  adapted from libtess example page https://brendankenny.github.io/libtess.js/examples/simple_triangulation/index.html
  */
  overrideTriangulate() {
    var tessy = (function initTesselator() {
      // function called for each vertex of tesselator output
      function vertexCallback(data, polyVertArray) {
        // console.log(data[0], data[1]);
        polyVertArray[polyVertArray.length] = data[0];
        polyVertArray[polyVertArray.length] = data[1];
      }
      function begincallback(type) {
        if (type !== libtess.primitiveType.GL_TRIANGLES) {
          console.log('expected TRIANGLES but got type: ' + type);
        }
      }
      function errorcallback(errno) {
        console.log('error callback');
        console.log('error number: ' + errno);
      }
      // callback for when segments intersect and must be split
      function combinecallback(coords, data, weight) {
        // console.log('combine callback');
        return [coords[0], coords[1], coords[2]];
      }
      function edgeCallback(flag) {
        // don't really care about the flag, but need no-strip/no-fan behavior
        // console.log('edge flag: ' + flag);
      }

      var tessy = new libtess.GluTesselator();
      tessy.gluTessProperty(libtess.gluEnum.GLU_TESS_WINDING_RULE, libtess.windingRule.GLU_TESS_WINDING_NONZERO);
      tessy.gluTessCallback(libtess.gluEnum.GLU_TESS_VERTEX_DATA, vertexCallback);
      tessy.gluTessCallback(libtess.gluEnum.GLU_TESS_BEGIN, begincallback);
      tessy.gluTessCallback(libtess.gluEnum.GLU_TESS_ERROR, errorcallback);
      tessy.gluTessCallback(libtess.gluEnum.GLU_TESS_COMBINE, combinecallback);
      tessy.gluTessCallback(libtess.gluEnum.GLU_TESS_EDGE_FLAG, edgeCallback);

      return tessy;
    })();

    THREE.ShapeUtils.triangulate = function ( contour, indices ) {

      if ( contour.length < 3 ) return null;

      var triangles = [];
      var map = {};

      var result = [];
      var vertIndices = [];

      // libtess will take 3d verts and flatten to a plane for tesselation
      // since only doing 2d tesselation here, provide z=1 normal to skip
      // iterating over verts only to get the same answer.
      // comment out to test normal-generation code
      tessy.gluTessNormal(0, 0, 1);

      tessy.gluTessBeginPolygon(triangles);

      // shape should be a single contour without holes anyway...
      tessy.gluTessBeginContour();
      contour.forEach((pt, i) => {
        var coord = [pt.x, pt.y, 0];
        tessy.gluTessVertex(coord, coord);
        map[coord[0] + ',' + coord[1]] = i; // store in map
      })
      tessy.gluTessEndContour();

      // finish polygon
      tessy.gluTessEndPolygon();

      // use map to convert points back to triangles of contour
      var nTri = triangles.length;

      for (var i = 0; i < nTri; i+=6) {
        var a = map[ triangles[i] + ',' + triangles[i+1] ],
          b = map[ triangles[i+2] + ',' + triangles[i+3] ],
          c = map[ triangles[i+4] + ',' + triangles[i+5] ];

        if (a == undefined || b == undefined || c == undefined) {continue;}
        vertIndices.push([a, b, c]);
        result.push( [ contour[ a ],
          contour[ b ],
          contour[ c ] ] );
      }

      if ( indices ) return vertIndices;
      return result;
    };
  }

  export() {
    if( this.user === null ) {
      alert( 'please login before saving a sketch.' )
      return
    }
    const that = this
    const app  = this
    const files = []

    const exportJSON = {
      camera: that.camera.threeCamera.toJSON(),
      soundObjects: that.soundObjects.map((obj) => {
        if (obj.file) addFile(obj.file);

        obj.cones.forEach((c) => {
          if (c.file) addFile(c.file);
        });

        return obj.toJSON();
      }),
      soundZones: that.soundZones.map((obj) => {
        if (obj.file) addFile(obj.file);
        return obj.toJSON();
      })
    }

    function addFile(file) {
      const fileExists = files.map(f => f.name).includes(file.name);
      if (!fileExists) files.push( file.name );
      const fileRef = app.storageref.child( `${app.user.email}/${file.name}` );
      fileRef.put( file ) 
    };

    exportJSON.files = files

    let count = 0, target = files.length

    const finish = function( str, file ) {
      //exportJSON.files.push( file.name )
      exportJSON.user = that.user.email

      //count++
      //if( count === target ) {
        const auth = document.getElementById('auth')
        auth.style.display = 'block'

        const div = document.createElement('div')
        div.setAttribute('class', 'firebaseui-container mdl-card mdl-shadow--2dp' ) 
        div.style.padding = '1em'

        const header = document.createElement( 'h1' )
        header.setAttribute( 'class', 'firebaseui-title' )
        header.innerText = 'Type in a name for your sketch.'         

        const input = document.createElement('input')
        input.value = 'sketch name'
        input.setAttribute( 'class', 'mdl-textfield__input firebaseui-input' ) 
        input.addEventListener( 'keyup', evt => {
          if( evt.key === 'Enter' ) {
            that.db.ref(`/sketches/${input.value}`).set( exportJSON )
            that.db.ref('/sketchesByUser').orderByChild( 'user' ).equalTo( that.user.email ).once( 'value', data => {
              const val = data.val()

              // only ask for new key if not replacing previous sketch
              let found = false
              for( let key in val ) {
                if( val[ key ].sketch === input.value ) found = true
              }
              if( found === false ) {
                const newPostKey = that.db.ref( '/sketchesByUser' ).push().key;
                that.db.ref(`/sketchesByUser/` + newPostKey).set({ sketch:input.value, user:that.user.email })
              }
            })
            auth.innerHTML = ''
            auth.style.display = 'none'
            that.interactionManager.active = true
          }
          evt.stopPropagation()
          return true
        })

        div.appendChild( header )
        div.appendChild( input )
        auth.appendChild( div )

        input.focus()
        that.interactionManager.active = false
      //}
    }

    finish()
    //for( let file of files ) {
      //if( file.data === undefined ) {
      //  const reader = new FileReader();
      //  reader.readAsDataURL( file ); 
      //  reader.onloadend = () => {
      //    const base64data = reader.result;
      //    finish( base64data, file )          
      //  }
      //}else{
      //  finish( file.data, file )
      //}
    //}

    // XXX get rid of this after testing
    window.files = files

    return exportJSON
  }

  __export() {
    const zipHelper = this.zipHelper;
    const that = this;

    let promise = new Promise(function(resolve, reject) {
      var files = [];

      const addFile = (file) => {
        const fileExists = files.map(f => f.name).includes(file.name);
        if (!fileExists) files.push(file);
      };

      const exportJSON = JSON.stringify({
        camera: that.camera.threeCamera.toJSON(),
        soundObjects: that.soundObjects.map((obj) => {
          if (obj.file) addFile(obj.file);

          obj.cones.forEach((c) => {
            if (c.file) addFile(c.file);
          });

          return obj.toJSON();
        }),
        soundZones: that.soundZones.map((obj) => {
          if (obj.file) addFile(obj.file);
          return obj.toJSON();
        }),
      }, null, 2);

      const configBlob = new Blob([exportJSON], {type: 'application/json'});
      const configFile = new File([configBlob], 'config.json');
      let exportFiles = files.concat([configFile]);

      zipHelper.addFiles(
        exportFiles,
        function() {},
        function(file) {},
        function(current, total) {},
        function() {
          zipHelper.getBlobURL(function(blobURL) {
            resolve(blobURL);
          });
        },
      );
    });

    return promise;
  }

  import( data ) {
    if( this.user !== null ) {
      const app = this
      const auth = document.getElementById('auth')
      auth.style.display = 'block'

      const div = document.createElement('div')
      div.setAttribute('class', 'firebaseui-container mdl-card mdl-shadow--2dp' ) 
      div.style.padding = '1em'

      const header = document.createElement( 'h1' )
      header.setAttribute( 'class', 'firebaseui-title' )
      header.innerText = 'Select a file to load.'

      const list = document.createElement( 'ul' )
      for( let name in this.user.files ) {
        const sketch = this.user.files[ name ]
        const li = document.createElement( 'li' )
        li.innerText = sketch.sketch
        li.style = 'cursor:pointer; text-decoration:underline'
        li.onclick = function()  {
          app.clear()
          app.importSketch( sketch.sketch )
          auth.innerHTML = ''
          auth.style.display = 'none'
        }

        list.appendChild( li )
      }

      div.appendChild( header )
      div.appendChild( list )
      auth.appendChild( div )
    }else{
      alert( 'please login before trying to load files.' )
    }
  }

  importSketch( filename ) {
    // orderByChild( 'user' ).equalTo( this.user.email ).
    const app = this
    this.db.ref(`/sketches/${filename}`).once('value').then( state => {
      const json = state.val() 
      let loader = new THREE.ObjectLoader();
      const cam = loader.parse(json.camera);

      const importedData = {}
      const storage = firebase.storage()
      let count = 0
      json.files.forEach( file => {
        //importedData[ file.name ] = file
        const pathReference = storage.ref(`${app.user.email}/${file}`);
        const urlPromise = pathReference.getDownloadURL().then( url => {
          fetch( url, { method:'GET' } )
            .then( data => data.arrayBuffer() )
            .then( buffer => {
              importedData[ file ] = buffer
              count++
              if( count === json.files.length ) finish()
            })
        })
      })

      function finish() {
        if( json.soundObjects !== undefined ) {
          json.soundObjects.forEach(obj => {
            let parsed = JSON.parse(obj);

            let newObj = app.path.createObject( app, true);
            newObj.fromJSON(obj, importedData, true );
            app.setActiveObject(newObj);
            app.isAddingObject = false;

            // Trajectory
            if (parsed.trajectory) {
              app.path.points = parsed.trajectory.map(i => new THREE.Vector3(i.x, i.y, i.z));
              app.path.parentObject = newObj;
              app.path.createObject(app, true);
              newObj.calculateMovementSpeed();
            }
          });
        }

        if( json.soundZones !== undefined ) {
          json.soundZones.forEach(obj => {
            var object = JSON.parse(obj);

            // Fakes drawing for zone creation
            this.path.points = object.points;

            let newObj = this.path.createObject(this, true);
            newObj.fromJSON(obj, importedData);

            this.setActiveObject(newObj);
            this.isAddingObject = false;
          });
        }

        app.setActiveObject(null);
        app.camera.threeCamera.copy(cam);
        app.camera.threeCamera.updateProjectionMatrix();
      }
    })
  }

  __import(data) {
    const zipHelper = this.zipHelper;
    var files = {};
    var promises = [];

    zipHelper.getEntries(data, (entries) => {
      promises = entries.map(function(entry) {
        return new Promise(function(resolve, reject) {
          zipHelper.getEntryFile(entry, function(filename, blob) {
              var fileReader = new FileReader();
              var fl = {};

              fileReader.onload = function() {
                if (filename === 'config.json') {
                  fl[filename] = fileReader.result;
                } else {
                  fl[filename] = new File([fileReader.result], filename);
                }

                resolve(fl);
              };

              if (filename === 'config.json') {
                fileReader.readAsText(blob);
              } else {
                fileReader.readAsArrayBuffer(blob);
              }

          }, function(current, total) {

          });
        });
      });

      Promise.all(promises).then((resolvedFiles) => {
        const importedData = Object.assign(...resolvedFiles);
        const config = importedData['config.json'];

        if (!config) {
          alert('no config');
          return;
        }

        let json = JSON.parse(config);
        let loader = new THREE.ObjectLoader();
        const cam = loader.parse(json.camera);

        json.soundObjects.forEach(obj => {
          let parsed = JSON.parse(obj);

          let newObj = this.path.createObject(this, true);
          newObj.fromJSON(obj, importedData);
          this.setActiveObject(newObj);
          this.isAddingObject = false;

          // Trajectory
          if (parsed.trajectory) {
            this.path.points = parsed.trajectory.map(i => new THREE.Vector3(i.x, i.y, i.z));
            this.path.parentObject = newObj;
            this.path.createObject(this, true);
            newObj.calculateMovementSpeed();
          }
        });

        json.soundZones.forEach(obj => {
          var object = JSON.parse(obj);

          // Fakes drawing for zone creation
          this.path.points = object.points;

          let newObj = this.path.createObject(this, true);
          newObj.fromJSON(obj, importedData);

          this.setActiveObject(newObj);
          this.isAddingObject = false;
        });

        this.setActiveObject(null);
        this.camera.threeCamera.copy(cam);
        this.camera.threeCamera.updateProjectionMatrix();
      });
    });
  }
}
