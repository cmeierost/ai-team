import type { IContainerToken } from '@ai-team/core';

type Factory<T> = (container: ServiceContainer<any>) => T;

type Lifetime = 'singleton' | 'transient';
type ServiceMap = Record<string, unknown>;

export type TokenSet = Record<string, IContainerToken<unknown>>;

type UnionToIntersection<U> = (U extends unknown ? (arg: U) => void : never) extends (
  arg: infer I
) => void
  ? I
  : never;

type TokenId<TToken extends IContainerToken<unknown>> = TToken extends {
  id: infer TId extends string;
}
  ? TId
  : string;

type TokenValue<TToken extends IContainerToken<unknown>> =
  TToken extends IContainerToken<infer TValue> ? TValue : never;

export type TokenMapFromSet<TSet extends TokenSet> = {
  [K in keyof TSet]: TokenValue<TSet[K]>;
};

export type MergeTokenSets<TSets extends readonly TokenSet[]> =
  UnionToIntersection<TokenMapFromSet<TSets[number]>> extends infer TMerged
    ? TMerged extends ServiceMap
      ? TMerged
      : {}
    : {};

interface Registration {
  factory: Factory<unknown>;
  lifetime: Lifetime;
}

export class ServiceContainer<TServices extends ServiceMap = {}> {
  private readonly singletons = new Map<string, unknown>();
  private readonly factories = new Map<string, Registration>();
  private readonly resolving: string[] = [];
  private readonly parent?: ServiceContainer<TServices>;

  constructor(parent?: ServiceContainer<TServices>) {
    this.parent = parent;
  }

  register<TToken extends IContainerToken<unknown>>(
    token: TToken,
    factory: (c: ServiceContainer<TServices>) => TokenValue<TToken>
  ): ServiceContainer<TServices & Record<TokenId<TToken>, TokenValue<TToken>>> {
    this.factories.set(token.id, {
      factory: factory as Factory<unknown>,
      lifetime: 'singleton',
    });
    this.singletons.delete(token.id);
    return this as unknown as ServiceContainer<
      TServices & Record<TokenId<TToken>, TokenValue<TToken>>
    >;
  }

  registerSingleton<TToken extends IContainerToken<unknown>>(
    token: TToken,
    factory: (c: ServiceContainer<TServices>) => TokenValue<TToken>
  ): ServiceContainer<TServices & Record<TokenId<TToken>, TokenValue<TToken>>> {
    return this.register(token, factory);
  }

  registerTransient<TToken extends IContainerToken<unknown>>(
    token: TToken,
    factory: (c: ServiceContainer<TServices>) => TokenValue<TToken>
  ): ServiceContainer<TServices & Record<TokenId<TToken>, TokenValue<TToken>>> {
    this.factories.set(token.id, {
      factory: factory as Factory<unknown>,
      lifetime: 'transient',
    });
    this.singletons.delete(token.id);
    return this as unknown as ServiceContainer<
      TServices & Record<TokenId<TToken>, TokenValue<TToken>>
    >;
  }

  registerInstance<TToken extends IContainerToken<unknown>>(
    token: TToken,
    instance: TokenValue<TToken>
  ): ServiceContainer<TServices & Record<TokenId<TToken>, TokenValue<TToken>>> {
    this.singletons.set(token.id, instance);
    this.factories.delete(token.id);
    return this as unknown as ServiceContainer<
      TServices & Record<TokenId<TToken>, TokenValue<TToken>>
    >;
  }

  resolve<TToken extends IContainerToken<unknown>>(
    token: TToken
  ): TokenId<TToken> extends keyof TServices ? TServices[TokenId<TToken>] : TokenValue<TToken> {
    if (this.singletons.has(token.id)) {
      return this.singletons.get(token.id) as TokenId<TToken> extends keyof TServices
        ? TServices[TokenId<TToken>]
        : TokenValue<TToken>;
    }

    const registration = this.factories.get(token.id);
    if (registration) {
      if (registration.lifetime === 'singleton') {
        return this.constructSingleton(
          token,
          registration.factory as Factory<TokenValue<TToken>>
        ) as TokenId<TToken> extends keyof TServices
          ? TServices[TokenId<TToken>]
          : TokenValue<TToken>;
      }
      return this.constructTransient(
        token,
        registration.factory as Factory<TokenValue<TToken>>
      ) as TokenId<TToken> extends keyof TServices
        ? TServices[TokenId<TToken>]
        : TokenValue<TToken>;
    }

    if (this.parent) {
      const inherited = this.parent.resolve(token) as unknown;
      this.singletons.set(token.id, inherited);
      return inherited as TokenId<TToken> extends keyof TServices
        ? TServices[TokenId<TToken>]
        : TokenValue<TToken>;
    }

    throw new Error(
      `ServiceContainer: no registration for ${token}.\n` +
        `Resolution chain: ${this.resolving.join(' → ') || '(root)'}`
    );
  }

  tryResolve<TToken extends IContainerToken<unknown>>(
    token: TToken
  ):
    | (TokenId<TToken> extends keyof TServices ? TServices[TokenId<TToken>] : TokenValue<TToken>)
    | undefined {
    try {
      return this.resolve(token);
    } catch (error: unknown) {
      if (error instanceof Error && error.message.startsWith('ServiceContainer: no registration')) {
        return undefined;
      }
      throw error;
    }
  }

  has(token: IContainerToken<unknown>): boolean {
    return (
      this.singletons.has(token.id) ||
      this.factories.has(token.id) ||
      (this.parent?.has(token) ?? false)
    );
  }

  child(): ServiceContainer<TServices> {
    return new ServiceContainer(this);
  }

  private constructSingleton<T>(token: IContainerToken<T>, factory: Factory<T>): T {
    if (this.resolving.includes(token.id)) {
      throw new Error(
        `ServiceContainer: circular dependency detected.\n` +
          `Resolution chain: ${[...this.resolving, token.id].join(' → ')}`
      );
    }

    this.resolving.push(token.id);
    try {
      const instance = factory(this);
      this.singletons.set(token.id, instance);
      return instance;
    } finally {
      this.resolving.pop();
    }
  }

  private constructTransient<T>(token: IContainerToken<T>, factory: Factory<T>): T {
    if (this.resolving.includes(token.id)) {
      throw new Error(
        `ServiceContainer: circular dependency detected.\n` +
          `Resolution chain: ${[...this.resolving, token.id].join(' → ')}`
      );
    }

    this.resolving.push(token.id);
    try {
      return factory(this);
    } finally {
      this.resolving.pop();
    }
  }
}

export function createContainerForTokenSets<const TSets extends readonly TokenSet[]>(
  ..._tokenSets: TSets
): ServiceContainer<MergeTokenSets<TSets>> {
  return new ServiceContainer<MergeTokenSets<TSets>>();
}
