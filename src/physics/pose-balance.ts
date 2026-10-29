import { Quaternion, Vector3 } from 'three';

export interface MassPoint { position: Vector3; mass: number }

/** Best rigid alignment of a newly commanded mass distribution to its previous
 * distribution. This removes net translation and rotation from the internal
 * shape change, without making its result depend on joint traversal order. */
export function balancePose(before: MassPoint[], after: MassPoint[]): {
  rotation: Quaternion; from: Vector3; to: Vector3;
} {
  if (before.length !== after.length) throw new Error('Mass point correspondence changed');
  const mass = before.reduce((sum, p) => sum + p.mass, 0);
  const from = new Vector3(), to = new Vector3();
  if (mass <= 0) return { rotation: new Quaternion(), from, to };
  before.forEach((p, i) => {
    to.addScaledVector(p.position, p.mass / mass);
    from.addScaledVector(after[i].position, p.mass / mass);
  });
  const h = Array<number>(9).fill(0);
  before.forEach((p, i) => {
    const a = after[i].position.clone().sub(from).toArray();
    const b = p.position.clone().sub(to).toArray();
    for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) h[3*j+k] += p.mass*a[j]*b[k];
  });
  // Quaternion form of the proper-rotation least-squares fit; reflections are excluded.
  const [xx,xy,xz,yx,yy,yz,zx,zy,zz] = h;
  const n = [
    [xx+yy+zz,yz-zy,zx-xz,xy-yx],
    [yz-zy,xx-yy-zz,xy+yx,xz+zx],
    [zx-xz,xy+yx,-xx+yy-zz,yz+zy],
    [xy-yx,xz+zx,yz+zy,-xx-yy+zz],
  ];
  const vectors = Array.from({length:4},(_,i) => Array.from({length:4},(_,j) => i===j ? 1 : 0) as number[]);
  const scale = Math.max(1,...n.flat().map(Math.abs));
  // Symmetric Jacobi eigensolver also handles a 180-degree rotation, whose
  // eigenvector is orthogonal to an identity-seeded power iteration.
  for (let iteration=0;iteration<80;iteration++) {
    let p=0,q=1;
    for(let i=0;i<4;i++) for(let j=i+1;j<4;j++) if(Math.abs(n[i][j])>Math.abs(n[p][q])) {p=i;q=j;}
    if(Math.abs(n[p][q])<1e-12*scale) break;
    const angle=.5*Math.atan2(2*n[p][q],n[q][q]-n[p][p]);
    const c=Math.cos(angle),s=Math.sin(angle),pp=n[p][p],qq=n[q][q],pq=n[p][q];
    for(let i=0;i<4;i++) if(i!==p&&i!==q) {
      const ip=n[i][p],iq=n[i][q];
      n[i][p]=n[p][i]=c*ip-s*iq;
      n[i][q]=n[q][i]=s*ip+c*iq;
    }
    n[p][p]=c*c*pp-2*s*c*pq+s*s*qq;
    n[q][q]=s*s*pp+2*s*c*pq+c*c*qq;
    n[p][q]=n[q][p]=0;
    for(let i=0;i<4;i++) {
      const ip=vectors[i][p],iq=vectors[i][q];
      vectors[i][p]=c*ip-s*iq;vectors[i][q]=s*ip+c*iq;
    }
  }
  let best=0;
  for(let i=1;i<4;i++) if(n[i][i]>n[best][best]) best=i;
  return {rotation:new Quaternion(vectors[1][best],vectors[2][best],vectors[3][best],vectors[0][best]).normalize(),from,to};
}
