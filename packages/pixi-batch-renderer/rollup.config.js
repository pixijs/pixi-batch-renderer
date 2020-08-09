import sourcemaps from 'rollup-plugin-sourcemaps';
import typescript from 'rollup-plugin-typescript';
import resolve from '@rollup/plugin-node-resolve';
import { terser } from 'rollup-plugin-terser';

const plugins = [
    typescript(),
    sourcemaps(),
    resolve({
        browser: true,
        preferBuiltins: false,
    }),
];

const external = ['pixi.js'];

const globals = {
    'pixi.js': 'PIXI',
};

const compiled = (new Date()).toUTCString().replace(/GMT/g, 'UTC');

const banner = [
    `/* eslint-disable */`,
    ``,
    `/*!`,
    ` * pixi-batch-renderer`,
    ` * Compiled ${compiled}`,
    ` *`,
    ` * pixi-batch-renderer is licensed under the MIT License.`,
    ` * http://www.opensource.org/licenses/mit-license`,
    ` * `,
    ` * Copyright (C) 2019-2020, Shukant Pal All Rights Reserved`,
    ` */`,
].join('\n');

const iifeBanner = [
    banner,
    `this.PIXI = this.PIXI || {}`,
    `this.PIXI.brend = this.PIXI.brend || {}`,
].join('\n');

const input = 'src/index.ts';
const name = '__batch_renderer';
const footer = `Object.assign(this.PIXI.brend, ${name});`;

export default [{
    plugins,
    external,
    input,
    output: [
        {
            banner,
            file: 'lib/pixi-batch-renderer.es.js',
            format: 'esm',
            sourcemap: true,
            freeze: false,
        },
        {
            banner,
            file: 'lib/pixi-batch-renderer.js',
            format: 'cjs',
            sourcemap: true,
            freeze: false,
        },
        {
            banner: iifeBanner,
            file: 'dist/pixi-batch-renderer.js',
            format: 'iife',
            sourcemap: true,
            freeze: false,
            globals,
            name,
            footer,
        },
    ],
    treeshake: false,
},
{
    plugins: [...plugins, terser({
        output: {
            comments: (node, comment) => comment.line === 1,
        },
    })],
    external,
    input,
    output: {
        banner: iifeBanner,
        file: 'dist/pixi-batch-renderer.min.js',
        format: 'iife',
        sourcemap: true,
        freeze: false,
        globals,
        name,
        footer,
    },
    treeshake: false,
}];
