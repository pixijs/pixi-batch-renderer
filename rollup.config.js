import sourcemaps from 'rollup-plugin-sourcemaps';
import typescript from 'rollup-plugin-typescript';
import commonjs from 'rollup-plugin-commonjs';
import resolve from '@rollup/plugin-node-resolve';
import { terser } from 'rollup-plugin-terser';

const plugins = [
    sourcemaps(),
    resolve({
        browser: true,
        preferBuiltins: false,
    }),
    commonjs({
        namedExports: {
            'resource-loader': ['Resource'],
        },
    }),
    typescript(),
];

const external = ['pixi.js'];

const globals = {
    'pixi.js': 'PIXI',
};

const compiled = (new Date()).toUTCString().replace(/GMT/g, 'UTC');

const banner = [
    `/*!`,
    ` * pixi-batch-renderer`,
    ` * Compiled ${compiled}`,
    ` *`,
    ` * pixi-batch-renderer is licensed under the MIT License.`,
    ` * http://www.opensource.org/licenses/mit-license`,
    ` */`,
    `this.PIXI = this.PIXI || {}`,
    `this.PIXI.brend = this.PIXI.brend || {}`,
].join('\n');

const input = 'src/index.js';
const name = '__batch_renderer';
const footer = `Object.assign(this.PIXI.brend, ${name}`;

export default [{
    plugins,
    external,
    globals,
    input,
    output: [
        {
            banner,
            file: 'lib/pixi-batch-renderer.mjs',
            format: 'esm',
            sourcemaps: true,
            freeze: false,
            globals,
        },
        {
            banner,
            file: 'lib/pixi-batch-renderer.cjs',
            format: 'cjs',
            sourcemaps: true,
            freeze: false,
            globals,
        },
        {
            banner,
            file: 'dist/pixi-batch-renderer.js',
            format: 'iife',
            sourcemaps: true,
            freeze: false,
            globals,
            name,
            footer,
            treeshake: false,
        },
    ],
},
{
    plugins: [...plugins, terser({
        output: {
            comments: (node, comment) => comment.line === 1,
        },
    })],
    external,
    globals,
    input,
    output: {
        banner,
        file: 'dist/pixi-batch-renderer.js',
        format: 'iife',
        sourcemaps: true,
        freeze: false,
        globals,
        name,
        footer,
        treeshake: false,
    },
}];