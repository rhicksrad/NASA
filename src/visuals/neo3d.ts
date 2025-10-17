import * as THREE from 'three';
import { jdFromDate, propagate, earthElementsApprox, type Keplerian } from '../utils/orbit';
const SCALE = 50;

export interface Body { name: string; els: Keplerian; color: number; mesh?: THREE.Object3D; trail?: THREE.Line; }
export interface Neo3DOptions { host: HTMLElement; }

export class Neo3D {
  private renderer = new THREE.WebGLRenderer({ antialias:true, alpha:true });
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private sun: THREE.Mesh;
  private earth: Body;
  private ring: THREE.Line;
  private bodies: Body[] = [];
  private t = Date.now();
  private dtMult = 1;
  private paused = false;

  constructor(opts: Neo3DOptions){
    const { host } = opts; const w = host.clientWidth||800, h = host.clientHeight||500;
    this.renderer.setSize(w,h,false); host.replaceChildren(this.renderer.domElement);
    this.camera = new THREE.PerspectiveCamera(50, w/h, 0.1, 10000); this.camera.position.set(0,2*SCALE,3*SCALE);
    this.scene.add(new THREE.AmbientLight(0xffffff,0.6)); const d=new THREE.DirectionalLight(0xffffff,0.6); d.position.set(2*SCALE,3*SCALE,1*SCALE); this.scene.add(d);
    this.sun = new THREE.Mesh(new THREE.SphereGeometry(0.07*SCALE,32,16), new THREE.MeshBasicMaterial({color:0xffcc00})); this.scene.add(this.sun);
    this.earth = { name:'Earth', els: earthElementsApprox(), color: 0x3b82f6 };
    const em = new THREE.Mesh(new THREE.SphereGeometry(0.02*SCALE,24,16), new THREE.MeshPhongMaterial({color:this.earth.color}));
    this.earth.mesh = em; this.scene.add(em);
    const curve = new THREE.EllipseCurve(0,0,SCALE,SCALE,0,Math.PI*2,false,0);
    const pts = curve.getPoints(256).map(p=>new THREE.Vector3(p.x,0,p.y));
    this.ring = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({color:0x9ca3af}));
    this.scene.add(this.ring);
    window.addEventListener('resize',()=>{ const W=host.clientWidth||800,H=host.clientHeight||500; this.renderer.setSize(W,H,false); this.camera.aspect=W/H; this.camera.updateProjectionMatrix(); });
  }

  addBodies(list: Body[]){
    for(const b of list){
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.012*SCALE,16,12), new THREE.MeshPhongMaterial({color:b.color}));
      const trail = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), new THREE.LineBasicMaterial({color:b.color, transparent:true, opacity:0.6}));
      b.mesh = mesh; b.trail = trail; this.scene.add(mesh); this.scene.add(trail); this.bodies.push(b);
    }
  }
  setBodies(list: Body[]){ this.clearBodies(); this.addBodies(list); }
  setTimeScale(m:number){ this.dtMult = m; }
  setPaused(p:boolean){ this.paused = p; }
  start(){ const loop=()=>{ requestAnimationFrame(loop); if(!this.paused) this.t += 16*this.dtMult; this.update(new Date(this.t)); this.renderer.render(this.scene,this.camera); }; loop(); }

  private update(now:Date){
    const jd = jdFromDate(now);
    { const [x,y,z]=propagate(this.earth.els,jd); this.earth.mesh!.position.set(x*SCALE,z*SCALE,y*SCALE); }
    for(const b of this.bodies){
      const [x,y,z]=propagate(b.els,jd); const pos=new THREE.Vector3(x*SCALE,z*SCALE,y*SCALE); b.mesh!.position.copy(pos);
      const g=b.trail!.geometry as THREE.BufferGeometry; const arr=g.getAttribute('position') as THREE.BufferAttribute;
      const prev=new THREE.Vector3().fromBufferAttribute(arr,1); arr.setXYZ(0,prev.x,prev.y,prev.z); arr.setXYZ(1,pos.x,pos.y,pos.z); arr.needsUpdate=true;
    }
  }

  private clearBodies(){
    for(const b of this.bodies){
      if(b.mesh) this.scene.remove(b.mesh);
      if(b.trail) this.scene.remove(b.trail);
    }
    this.bodies = [];
  }
}
