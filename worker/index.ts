/**
 * Cloudflare Workers entry point.
 *
 * The Express app is served through Workers' Node.js HTTP server compatibility
 * (compatibility_date >= 2025-09-01 + nodejs_compat). Static files are handled by the
 * assets binding configured in wrangler.jsonc; only /api/* reaches this code.
 */
import { createServer } from 'node:http';
import { httpServerHandler } from 'cloudflare:node';
import { app } from '../server/app.js';

const PORT = 8080;
createServer(app).listen(PORT);

export default httpServerHandler({ port: PORT });
