import geospatial from '@convex-dev/geospatial/convex.config.js';
import { defineApp } from 'convex/server';

const app = defineApp();
app.use(geospatial);
export default app;
