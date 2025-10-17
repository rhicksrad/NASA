const DEG = Math.PI / 180;
const TWO_PI = Math.PI * 2;
const K = 0.01720209895; // sqrt(GM_sun) AU^(3/2)/day

export interface Keplerian {
  a: number; e: number; i: number; Omega: number; omega: number; M: number; epochJD: number;
}
export function jdFromDate(d: Date): number { return d.getTime()/86400000 + 2440587.5; }
function wrapPi(x: number){ return ((x+Math.PI)%TWO_PI)-Math.PI; }

function solveElliptic(M: number, e: number){ let E = e<0.8?M:Math.PI; for(let k=0;k<20;k++){const f=E-e*Math.sin(E)-M, fp=1-e*Math.cos(E), d=-f/fp; E+=d; if(Math.abs(d)<1e-12)break;} return E; }
function solveHyperbolic(Mh:number,e:number){ let H=Math.log(2*Math.abs(Mh)/e+1.8); if(Mh<0)H=-H; for(let k=0;k<30;k++){const s=Math.sinh(H),c=Math.cosh(H),f=e*s-H-Mh,fp=e*c-1,d=-f/fp; H+=d; if(Math.abs(d)<1e-12)break;} return H; }

export function propagate(els:Keplerian,jd:number):[number,number,number]{
  const e=els.e, i=els.i*DEG, O=els.Omega*DEG, w=els.omega*DEG, dt=jd-els.epochJD;
  let xp=0, yp=0;
  if(e<1){
    const a=els.a, n=K/Math.sqrt(a*a*a), M=wrapPi(els.M*DEG + n*dt), E=solveElliptic(M,e);
    const r=a*(1-e*Math.cos(E)), s=Math.sqrt(1-e*e);
    const cosv=(Math.cos(E)-e)/(1-e*Math.cos(E)), sinv=(s*Math.sin(E))/(1-e*Math.cos(E));
    xp=r*cosv; yp=r*sinv;
  } else {
    const aAbs=Math.abs(els.a), n=K/Math.sqrt(aAbs*aAbs*aAbs), Mh=els.M*DEG + n*dt, H=solveHyperbolic(Mh,e);
    const ch=Math.cosh(H), sh=Math.sinh(H), r=aAbs*(e*ch-1), s=Math.sqrt(e*e-1);
    const cosv=(e-ch)/(e*ch-1), sinv=(s*sh)/(e*ch-1);
    xp=r*cosv; yp=r*sinv;
  }
  const cO=Math.cos(O), sO=Math.sin(O), ci=Math.cos(i), si=Math.sin(i), cw=Math.cos(w), sw=Math.sin(w);
  const X=(cO*cw-sO*sw*ci)*xp + (-cO*sw - sO*cw*ci)*yp;
  const Y=(sO*cw+cO*sw*ci)*xp + (-sO*sw + cO*cw*ci)*yp;
  const Z=(si*sw)*-xp + (si*cw)*yp;
  return [X,Y,Z];
}

export function earthElementsApprox(jdEpoch=2451545.0):Keplerian{
  return { a:1.00000261,e:0.01671123,i:0.00005,Omega:-11.26064,omega:102.94719,M:100.46435,epochJD:jdEpoch };
}

export function fromSbdb(orbit:{e:string;a?:string;q?:string;i:string;om:string;w:string;ma?:string;M?:string;epoch:string;}):Keplerian{
  const e=Number(orbit.e), i=Number(orbit.i), Omega=Number(orbit.om), omega=Number(orbit.w), epochJD=Number(orbit.epoch);
  const Mdeg = orbit.ma!=null ? Number(orbit.ma) : (orbit.M!=null ? Number(orbit.M) : 0);
  let a = orbit.a!=null ? Number(orbit.a) : undefined;
  const q = orbit.q!=null ? Number(orbit.q) : undefined;
  if(a==null && q!=null){ a = e<1 ? q/(1-e) : -q/(e-1); }
  if(a==null) throw new Error('Cannot derive semi-major axis');
  return { a, e, i, Omega, omega, M:Mdeg, epochJD };
}
