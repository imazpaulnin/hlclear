declare module "@walletconnect/universal-provider" {
  export interface WalletConnectSession {
    topic: string;
    namespaces?: Record<string, { accounts?: string[] }>;
  }

  export interface WalletConnectConnectParams {
    namespaces: Record<
      string,
      {
        methods: string[];
        chains: string[];
        events: string[];
      }
    >;
  }

  export interface WalletConnectUniversalProvider {
    connect(params: WalletConnectConnectParams): Promise<WalletConnectSession>;
    disconnect(): Promise<void>;
    request(request: { method: string; params?: unknown[] | Record<string, unknown> }, chainId?: string): Promise<unknown>;
    on(event: string, listener: (...args: unknown[]) => void): void;
    removeListener(event: string, listener: (...args: unknown[]) => void): void;
  }

  export const UniversalProvider: {
    init(config: {
      projectId: string;
      metadata: {
        name: string;
        description: string;
        url: string;
        icons: string[];
      };
      logger?: string;
    }): Promise<WalletConnectUniversalProvider>;
  };

  export default UniversalProvider;
}
