// Minimal typing for the Workers-only module so `tsc` passes without @cloudflare/workers-types.
declare module 'cloudflare:node' {
  export function httpServerHandler(options: { port: number }): {
    fetch(request: Request, env: unknown, ctx: unknown): Promise<Response>;
  };
}
