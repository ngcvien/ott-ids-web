import { readFile, writeFile } from 'node:fs/promises';
import { createGwm } from '../src/server/gwm-format.mjs';
import { packModel, validateModel } from '../src/server/model-format.mjs';

const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, arg, i, all) => arg.startsWith('--') ? [...pairs, [arg.slice(2), all[i+1]]] : pairs, []));
if (!args.input || !args.output || args.version === undefined) throw new Error('Usage: npm run model:pack -- --input nodes.mem (or generated .h) --version 0x02000001 --output model.gwm');
const source = await readFile(args.input, 'utf8');
const words = args.input.endsWith('.h') ? [...source.matchAll(/UINT64_C\(0x([A-Fa-f0-9]{16})\)/g)].map(match => match[1]) :
  source.split(/\r?\n/).map(line => line.replace(/\/\/.*$/, '').trim()).filter(Boolean);
const model = validateModel(packModel(words, Number(args.version)));
if (!/\.(gwm|json)$/i.test(args.output)) throw new Error('Output must end with .gwm (or legacy .json)');
await writeFile(args.output, args.output.toLowerCase().endsWith('.gwm') ? createGwm(model) : JSON.stringify(model, null, 2) + '\n', { flag: 'wx' });
console.log(`Packed ${model.node_count} nodes, ABI ${model.abi}, version ${model.version}, CRC ${model.crc32}, SHA256 ${model.sha256}.`);
