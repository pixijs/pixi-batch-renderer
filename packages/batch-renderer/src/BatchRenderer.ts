import { StdBatchFactory } from './StdBatchFactory';
import { BatchGeometryFactory } from './BatchGeometryFactory';
import { AttributeRedirect } from './redirects/AttributeRedirect';
import { BatchDrawer } from './BatchDrawer';
import { ENV } from '@pixi/constants';
import { ObjectRenderer, State } from '@pixi/core';
import { UniformRedirect } from './redirects/UniformRedirect';
import { resolve } from './utils/resolveProperty';
import { resolveFunctionOrProperty } from './resolve';
import { settings } from '@pixi/settings';

import type {
    Renderer,
    Shader
} from '@pixi/core';
import type { DisplayObject } from '@pixi/display';

export interface IBatchRendererOptions
{
    // Standard pipeline
    attribSet: AttributeRedirect[];
    indexProperty: string;
    indexCountProperty?: string | number | ((object: DisplayObject) => number);
    vertexCountProperty?: string | number | ((object: DisplayObject) => number);
    textureProperty: string;
    texturesPerObject?: number;
    texIDAttrib: string;
    inBatchIDAttrib?: string;
    masterIDAttrib?: string;
    stateFunction?: (renderer: DisplayObject) => State;
    shaderFunction: (renderer: BatchRenderer) => Shader;

    // Components
    BatchFactoryClass?: typeof StdBatchFactory;
    BatchGeometryFactoryClass?: typeof BatchGeometryFactory;
    BatchDrawerClass?: typeof BatchDrawer;

    // Uniforms+Standard Pipeline
    uniformSet?: UniformRedirect[];
    uniformIDAttrib?: string;
}

/**
 * This object renderer renders multiple display-objects in batches. It can greatly
 * reduce the number of draw calls issued per frame.
 *
 * ## Batch Rendering Pipeline
 *
 * The batch rendering pipeline consists of the following stages:
 *
 * * **Display-Object Buffering**: Each display-object is kept in a buffer until it fills up or a
 * flush is required.
 *
 * * **Batch Generation**: In a sliding window, display-object batches are generated based off of certain
 * constraints like GPU texture units and the uniforms used in each display-object. This is done using an
 * instance of {@link BatchFactory}.
 *
 * * **Geometry Composition**: The geometries of all display-objects are merged together in a
 * composite geometry. This is done using an instance of {@link BatchGeometryFactory}.
 *
 * * **Drawing**: Each batch is rendered in-order using `gl.draw*`. The textures and
 * uniforms of each display-object are uploaded as arrays. This is done using an instance of
 * {@link BatchDrawer}.
 *
 * Each stage in this pipeline can be configured by overriding the appropriate component and passing that
 * class to `BatchRendererPluginFactory.from*`.
 *
 * ## Shaders
 *
 * ### Shader templates
 *
 * Since the max. display-object count per batch is not known until the WebGL context is created,
 * shaders are generated at runtime by processing shader templates. A shader templates has "%macros%"
 * that are replaced by constants at runtime.
 *
 * To use shader templates, simply use {@link BatchShaderFactory#derive}. This will generate a
 * function that derives a shader from your template at runtime.
 *
 * ### Textures
 *
 * The batch renderer uploads textures in the `uniform sampler2D uSamplers[%texturesPerBatch%];`. The
 * `varying float vTextureId` defines the index into this array that holds the current display-object's
 * texture.
 *
 * ### Uniforms
 *
 * This renderer currently does not support customized uniforms for display-objects. This is a
 * work-in-progress feature.
 *
 * ## Learn more
 * This batch renderer uses the PixiJS object-renderer API to hook itself:
 *
 * 1. [PIXI.ObjectRenderer]{@link http://pixijs.download/release/docs/PIXI.ObjectRenderer.html}
 *
 * 2. [PIXI.AbstractBatchRenderer]{@link http://pixijs.download/release/docs/PIXI.AbstractBatchRenderer.html}
 *
 * @example
 * import * as PIXI from 'pixi.js';
 * import { BatchRendererPluginFactory } from 'pixi-batch-renderer';
 *
 * // Define the geometry of your display-object and create a BatchRenderer using
 * // BatchRendererPluginFactory. Register it as a plugin with PIXI.Renderer.
 * PIXI.Renderer.registerPlugin('ExampleBatchRenderer', BatchRendererPluginFactory.from(...));
 *
 * class ExampleObject extends PIXI.Container
 * {
 *     _render(renderer: PIXI.Renderer): void
 *     {
 *          // BatchRenderer will handle the whole rendering process for you!
 *          renderer.batch.setObjectRenderer(renderer.plugins['ExampleBatchRenderer']);
 *          renderer.plugins['ExampleBatchRenderer'].render(this);
 *     }
 * }
 */
export class BatchRenderer extends ObjectRenderer
{
    /** @protected */
    public renderer: Renderer;

    // Standard pipeline
    /**
     * Attribute redirects
     *
     * @access protected
     */
    readonly _attribRedirects: AttributeRedirect[];

    /**
     * Indices property
     *
     * @access protected
     */
    readonly _indexProperty: string;

    /**
     * A manual resolution of the number of indicies in a display object's geometry. This is ignored if the
     * index buffer is not used (see _indexProperty). If not provided, the index buffer's entire length
     * is used.
     * 
     * @access protected
     */
    readonly _indexCountProperty: string | number | ((object: DisplayObject) => number);

    /**
     * A manual resolution of the number of vertices in a display object's geometry. If not provided, this is
     * calculated as the number of element in the first attribute's buffer.
     *
     * @access protected
     */
    readonly _vertexCountProperty: string | number | ((object: DisplayObject) => number);
    readonly _textureProperty: string;
    readonly _texturesPerObject: number;
    readonly _texIDAttrib: string;
    readonly _inBatchIDAttrib: string;
    readonly _stateFunction: Function;
    readonly _shaderFunction: Function;

    // Uniforms+Standard Pipeline
    readonly _uniformRedirects: UniformRedirect[];
    readonly _uniformIDAttrib: string;

    // Master-ID optimization
    readonly _masterIDAttrib: string;

    // API Visiblity Note: These properties are used by component/factories and must be public;
    // however, they are prefixed with an underscore because they are not for exposure to the end-user.

    // Components
    _batchFactory: StdBatchFactory;
    _geometryFactory: BatchGeometryFactory;
    _drawer: BatchDrawer;

    // Display-object buffering
    _objectBuffer: DisplayObject[];
    _bufferedVertices: number;
    _bufferedIndices: number;

    // Drawer
    _shader: Shader;

    // WebGL Context config
    MAX_TEXTURES: number;

    // Component ctors
    protected readonly _BatchFactoryClass: typeof StdBatchFactory;
    protected readonly _BatchGeometryFactoryClass: typeof BatchGeometryFactory;
    protected readonly _BatchDrawerClass: typeof BatchDrawer;

    // Additional args
    protected readonly options: any;

    /**
     * Creates a batch renderer the renders display-objects with the described geometry.
     *
     * To register a batch-renderer plugin, you must use the API provided by `BatchRendererPluginFactory`.
     *
     * @param {PIXI.Renderer} renderer - renderer to attach to
     * @param {object} options
     * @param {AttributeRedirect[]} options.attribSet
     * @param {string | null} options.indexProperty
     * @param {string | number} [options.vertexCountProperty]
     * @param {string | null} options.textureProperty
     * @param {number} [options.texturesPerObject=1]
     * @param {string} options.texIDAttrib - name of texture-id attribute variable
     * @param {Function}[options.stateFunction=PIXI.State.for2d()] - returns a `PIXI.State` for an object
     * @param {Function} options.shaderFunction - generates a shader given this instance
     * @param {Class} [options.BatchGeometryFactory=BatchGeometry]
     * @param {Class} [options.BatchFactoryClass=StdBatchFactory]
     * @param {Class} [options.BatchDrawer=BatchDrawer]
     * @see BatchShaderFactory
     * @see StdBatchFactory
     * @see BatchGeometryFactory
     * @see BatchDrawer
     */
    constructor(renderer: Renderer, options: IBatchRendererOptions)
    {
        super(renderer);

        this._attribRedirects = options.attribSet;
        this._indexProperty = options.indexProperty;
        this._indexCountProperty = options.indexCountProperty;
        this._vertexCountProperty = options.vertexCountProperty;

        /**
         * Texture(s) property
         * @member {string}
         * @protected
         * @readonly
         */
        this._textureProperty = options.textureProperty;

        /**
         * Textures per display-object
         * @member {number}
         * @protected
         * @readonly
         * @default 1
         */
        this._texturesPerObject = typeof options.texturesPerObject !== 'undefined' ? options.texturesPerObject : 1;

        /**
         * Texture ID attribute
         * @member {string}
         * @protected
         * @readonly
         */
        this._texIDAttrib = options.texIDAttrib;

        /**
         * Indexes the display-object in the batch.
         * @member {string}
         * @protected
         * @readonly
         */
        this._inBatchIDAttrib = options.inBatchIDAttrib;

        /**
         * State generating function (takes a display-object)
         * @member {Function}
         * @default () => PIXI.State.for2d()
         * @protected
         * @readonly
         */
        this._stateFunction = options.stateFunction || ((): State => State.for2d());

        /**
         * Shader generating function (takes the batch renderer)
         * @member {Function}
         * @protected
         * @see BatchShaderFactory
         * @readonly
         */
        this._shaderFunction = options.shaderFunction;

        /**
         * Batch-factory class.
         * @member {Class}
         * @protected
         * @default StdBatchFactory
         * @readonly
         */
        this._BatchFactoryClass = options.BatchFactoryClass || StdBatchFactory;

        /**
         * Batch-geometry factory class. Its constructor takes one argument - this batch renderer.
         * @member {Class}
         * @protected
         * @default BatchGeometryFactory
         * @readonly
         */
        this._BatchGeometryFactoryClass = options.BatchGeometryFactoryClass || BatchGeometryFactory;

        /**
         * Batch drawer class. Its constructor takes one argument - this batch renderer.
         * @member {Class}
         * @protected
         * @default BatchDrawer
         * @readonly
         */
        this._BatchDrawerClass = options.BatchDrawerClass || BatchDrawer;

        /**
         * Uniform redirects. If you use uniforms in your shader, be sure to use one the compatible
         * batch factories (like {@link AggregateUniformsBatchFactory}).
         * @member {UniformRedirect[]}
         * @protected
         * @default null
         * @readonly
         */
        this._uniformRedirects = options.uniformSet || null;

        /**
         * Indexes the uniforms of the display-object in the uniform arrays. This is not equal to the
         * in-batch ID because equal uniforms are not uploaded twice.
         * @member {string}
         * @protected
         * @readonly
         */
        this._uniformIDAttrib = options.uniformIDAttrib;

        /**
         * This is an advanced feature that allows you to pack the {@code _texIDAttrib}, {@code _uniformIDAttrib},
         * {@code _inBatchIDAttrib}, and other information into one 32-bit float attribute. You can then unpack
         * them in the vertex shader and pass varyings to the fragment shader (because {@code int} varyings are not
         * supported).
         *
         * To use it, you must provide your own {@link BatchGeometryFactory} that overrides
         * {@link BatchGeometryFactory#append} and sets the {@code _masterIDAttrib}.
         */
        this._masterIDAttrib = options.masterIDAttrib;

        /**
         * The options used to create this batch renderer.
         * @readonly {object}
         * @protected
         * @readonly
         */
        this.options = options;

        if (options.masterIDAttrib)
        {
            this._texIDAttrib = this._masterIDAttrib;
            this._uniformIDAttrib = this._masterIDAttrib;
            this._inBatchIDAttrib = this._masterIDAttrib;
        }

        // Although the runners property is not a public API, it is required to
        // handle contextChange events.
        this.renderer.runners.contextChange.add(this);

        // If the WebGL context has already been created, initialization requires a
        // syntheic call to contextChange.
        if (this.renderer.gl)
        {
            this.contextChange();
        }

        this._objectBuffer = [];
        this._bufferedVertices = 0;
        this._bufferedIndices = 0;
        this._shader = null;
    }

    /**
     * Internal method that is called whenever the renderer's WebGL context changes.
     */
    contextChange(): void
    {
        const gl = this.renderer.gl;

        if (settings.PREFER_ENV === ENV.WEBGL_LEGACY)
        {
            this.MAX_TEXTURES = 1;
        }
        else
        {
            this.MAX_TEXTURES = Math.min(gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS), settings.SPRITE_MAX_TEXTURES);
        }

        /**
         * @member {_BatchFactoryClass}
         * @readonly
         * @protected
         */
        this._batchFactory = new this._BatchFactoryClass(this);

        /**
         * @member {_BatchGeometryFactoryClass}
         * @readonly
         * @protected
         */
        this._geometryFactory = new this._BatchGeometryFactoryClass(this);

        /**
         * @member {_BatchDrawerClass}
         * @readonly
         * @protected
         */
        this._drawer = new this._BatchDrawerClass(this);
    }

    /**
     * This is an internal method. It ensures that the batch renderer is ready to start buffering display-objects.
     * This is automatically invoked by the renderer's batch system.
     *
     * @override
     */
    start(): void
    {
        this._objectBuffer.length = 0;
        this._bufferedVertices = 0;
        this._bufferedIndices = 0;

        this._shader = this._shaderFunction(this);
    }

    /**
     * Adds the display-object to be rendered in a batch. Your display-object's render/_render method should call
     * this as follows:
     *
     * ```js
     * renderer.setObjectRenderer(<BatchRenderer>);
     * <BatchRenderer>.render(this);
     * ```
     *
     * @override
     */
    render(displayObject: DisplayObject): void
    {
        this._objectBuffer.push(displayObject);

        this._bufferedVertices += this.calculateVertexCount(displayObject);

        if (this._indexProperty)
        {
            this._bufferedIndices += this.calculateIndexCount(displayObject);
        }
    }

    /**
     * Forces buffered display-objects to be rendered immediately. This should not be called unless absolutely
     * necessary like the following scenarios:
     *
     * * before directly rendering your display-object, to preserve render-order.
     *
     * * to do a nested render pass (calling `Renderer#render` inside a `render` method)
     *   because the PixiJS renderer is not re-entrant.
     *
     * @override
     */
    flush(): void
    {
        const { _batchFactory: batchFactory, _geometryFactory: geometryFactory, _stateFunction: stateFunction } = this;
        const buffer = this._objectBuffer;
        const bufferLength = buffer.length;

        // Reset components
        batchFactory.reset();
        geometryFactory.init(this._bufferedVertices, this._bufferedIndices);

        let batchStart = 0;

        // Loop through display-objects and create batches
        for (let objectIndex = 0; objectIndex < bufferLength;)
        {
            const target = buffer[objectIndex];
            const wasPut = batchFactory.put(target, resolveFunctionOrProperty(target, stateFunction));

            if (!wasPut)
            {
                batchFactory.build(batchStart);
                batchStart = objectIndex;
            }
            else
            {
                ++objectIndex;
            }
        }

        // Generate the last batch, if required.
        if (!batchFactory.ready())
        {
            batchFactory.build(batchStart);
        }

        const batchList = batchFactory.access();
        const batchCount = batchFactory.size();
        let indices = 0;

        // Loop through batches and their display-object list to compose geometry
        for (let i = 0; i < batchCount; i++)// loop-per(batch)
        {
            const batch = batchList[i];
            const batchBuffer = batch.batchBuffer;
            const batchLength = batchBuffer.length;

            let vertexCount = 0;
            let indexCount = 0;

            batch.geometryOffset = indices;

            for (let j = 0; j < batchLength; j++)// loop-per(targetObject)
            {
                const targetObject = batchBuffer[j];

                if (this._indexProperty)
                {
                    indexCount += this.calculateIndexCount(targetObject);
                }
                else
                {
                    vertexCount += this.calculateVertexCount(targetObject);
                }

                geometryFactory.append(targetObject, batch);
            }

            // externally-defined properties for draw calls
            batch.$vertexCount = vertexCount;
            batch.$indexCount = indexCount;

            indices += batch.$indexCount;
        }

        // BatchDrawer handles the rest!
        this._drawer.draw();
    }

    /**
     * Internal method that stops buffering of display-objects and flushes any existing buffers.
     *
     * @override
     */
    stop(): void
    {
        if (this._bufferedVertices)
        {
            this.flush();
        }
    }

    /**
     * Calculates the number of vertices in the display object's geometry.
     *
     * @param object
     */
    protected calculateVertexCount(object: DisplayObject): number
    {
        return resolve(
            object, 
            this._vertexCountProperty,
            resolve<ArrayLike<number>>(object, this._attribRedirects[0].source).length / (this._attribRedirects[0].size as number)
        );    
    }

    /**
     * Calculates the number of indices in the display object's geometry.
     *
     * @param object 
     */
    protected calculateIndexCount(object: DisplayObject): number
    {
        if (!this._indexProperty)
        {
            return 0;
        }

        return resolve(
            object,
            this._indexCountProperty,
            resolve<Uint16Array>(object, this._indexProperty).length,
        );
    }
}

export default BatchRenderer;
