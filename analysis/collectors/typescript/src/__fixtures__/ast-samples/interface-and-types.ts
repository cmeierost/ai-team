export interface Repository<T> {
  find(id: string): Promise<T | null>;
  findAll(): Promise<T[]>;
  save(entity: T): Promise<void>;
  delete(id: string): Promise<boolean>;
}

export type Predicate<T> = (item: T) => boolean;

export abstract class BaseEntity {
  abstract get id(): string;
  abstract validate(): boolean;

  isValid(): boolean {
    return this.validate();
  }
}
