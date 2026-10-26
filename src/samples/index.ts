import { CAR } from './car';
import { PLANE } from './plane';

export interface Sample {
  name: string;
  source: string;
}

export const SAMPLES: Sample[] = [
  { name: 'car', source: CAR },
  { name: 'plane', source: PLANE },
];
