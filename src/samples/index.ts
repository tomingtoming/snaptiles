import { CAR } from './car';

export interface Sample {
  name: string;
  source: string;
}

export const SAMPLES: Sample[] = [{ name: 'car', source: CAR }];
