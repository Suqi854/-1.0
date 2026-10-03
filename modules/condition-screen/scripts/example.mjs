import { screen, swingPreset } from '../src/index.js';
import { createMockSnapshot } from '../src/mock.js';
const report = screen(createMockSnapshot(), swingPreset);
console.log(JSON.stringify(report, null, 2));
