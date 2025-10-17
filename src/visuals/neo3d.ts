import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { jdFromDate, propagate, earthElementsApprox, type Keplerian } from '../utils/orbit';

const SCALE = 120, SUN_R = 0.12*SCALE, EARTH_R = 0.03*SCALE;

export interface Body { name: string; els: Keplerian; color: number; mesh?: THREE.Object3D; trail?: THREE.Line; }
export interface Neo3DOptions { host: HTMLElement; dateLabel?: HTMLElement | null; }

export class Neo3D {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private clock = new THREE.Clock();
  private earth: Body;
  private bodies: Body[] = [];
  private simMs = Date.now();       // simulated UTC ms
  private dtMult = 86400;           // seconds of sim-time per real second (1 day/s)
  private paused = false;

  constructor(private opts: Neo3DOptions){
    const { host } = opts;
    const w = host.clientWidth||800, h = host.clientHeight||520;

    this.renderer = new THREE.WebGLRenderer({ antialias:true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio,2));
    this.renderer.setSize(w,h,false);
    host.replaceChildren(this.renderer.domElement);
    this.renderer.setClearColor(0x0b3d91, 1);

    this.camera = new THREE.PerspectiveCamera(55, w/h, 0.1, 100000);
    this.camera.position.set(0,2.2*SCALE,3.2*SCALE);
    this.camera.lookAt(0,0,0);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true; this.controls.dampingFactor = 0.05;
    this.controls.enablePan = true; this.controls.enableZoom = true;

    const amb = new THREE.AmbientLight(0xffffff,0.7);
    const dir = new THREE.DirectionalLight(0xffffff,0.9);
    dir.position.set(3*SCALE,4*SCALE,2*SCALE);
    this.scene.add(amb,dir);

    const sun = new THREE.Mesh(new THREE.SphereGeometry(SUN_R,48,32),
      new THREE.MeshPhongMaterial({ color:0xffe066, emissive:0xffd166, emissiveIntensity:0.8 }));
    this.scene.add(sun);

    this.earth = { name:'Earth', els: earthElementsApprox(), color:0x64b5f6 };
    const earthMesh = new THREE.Mesh(new THREE.SphereGeometry(EARTH_R,48,32),
      new THREE.MeshPhongMaterial({ color:this.earth.color }));
    this.earth.mesh = earthMesh; this.scene.add(earthMesh);

    const N=256, pts:THREE.Vector3[]=[];
    for(let k=0;k<=N;k++){ const a=(k/N)*Math.PI*2; pts.push(new THREE.Vector3(Math.cos(a)*SCALE,0,Math.sin(a)*SCALE)); }
    this.scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts),
      new THREE.LineBasicMaterial({ color:0xffffff, linewidth:2 })));

    const grid=new THREE.GridHelper(3*SCALE,24,0xd9e3f0,0x4267b2);
    (grid.material as THREE.Material).transparent = true; (grid.material as THREE.Material).opacity = 0.25;
    this.scene.add(grid);

    window.addEventListener('resize', ()=>this.onResize());
    document.addEventListener('visibilitychange', ()=>{
      if (document.hidden) { this.paused = true; }
      else { this.clock.stop(); this.clock.start(); this.paused = false; }  // resume cleanly
    });
  }

  addBodies(list: Body[]){
    for(const b of list){
      const mesh=new THREE.Mesh(new THREE.SphereGeometry(0.012*SCALE,20,14),
        new THREE.MeshPhongMaterial({ color:b.color }));
      const trail=new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
        new THREE.LineBasicMaterial({ color:b.color, transparent:true, opacity:0.7 })
      );
      b.mesh=mesh; b.trail=trail; this.scene.add(mesh,trail); this.bodies.push(b);
    }
  }

  setTimeScale(m:number){ this.dtMult = m; }
  setPaused(p:boolean){
    this.paused = p;
    if (!p) { this.clock.stop(); this.clock.start(); } // reset delta to avoid jump
  }

  start(){
    this.clock.start();
    const loop = () => {
      requestAnimationFrame(loop);
      if (!this.paused) {
        const realSec = this.clock.getDelta();              // real seconds since last frame
        this.simMs += realSec * 1000 * this.dtMult;         // advance simulated ms
      }
      this.update(new Date(this.simMs));
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
    };
    loop();
  }

  private update(now:Date){
    const jd = jdFromDate(now);
    const dateLabel = this.opts.dateLabel;
    if (dateLabel) dateLabel.textContent = now.toISOString().slice(0,19).replace('T',' ');

    { const [x,y,z]=propagate(this.earth.els,jd); this.earth.mesh!.position.set(x*SCALE, z*SCALE, y*SCALE); }
    for(const b of this.bodies){
      const [x,y,z]=propagate(b.els,jd);
      const pos=new THREE.Vector3(x*SCALE,z*SCALE,y*SCALE);
      b.mesh!.position.copy(pos);
      const g=b.trail!.geometry as THREE.BufferGeometry;
      const arr=g.getAttribute('position') as THREE.BufferAttribute;
      const prev=new THREE.Vector3().fromBufferAttribute(arr,1);
      arr.setXYZ(0,prev.x,prev.y,prev.z); arr.setXYZ(1,pos.x,pos.y,pos.z); arr.needsUpdate=true;
    }
  }

  private onResize(){
    const host=this.opts.host, w=host.clientWidth||800, h=host.clientHeight||520;
    this.renderer.setSize(w,h,false); this.camera.aspect=w/h; this.camera.updateProjectionMatrix();
  }
}
