import { CAR } from './car';
import { PLANE } from './plane';
import { WALKER } from './walker';
import { HOVER } from './hover';
import { TANK } from './tank';

export interface Sample {
  name: string;
  source: string;
}

export const SAMPLES: Sample[] = [
  { name: 'car', source: CAR },
  { name: 'plane', source: PLANE },
  { name: 'walker', source: WALKER },
  { name: 'hover', source: HOVER },
  { name: 'tank', source: TANK },
];
