import { CreateOptions, FireOptions, HireOptions, InitOptions } from './streaming';

export interface IHrService {
  create(type: string, options: CreateOptions): Promise<void>;
  hire(options: HireOptions): Promise<void>;
  fire(employeeQuery: string, options: FireOptions): Promise<void>;
  init(options: InitOptions): Promise<void>;
  hhRefresh(): Promise<void>;
}
