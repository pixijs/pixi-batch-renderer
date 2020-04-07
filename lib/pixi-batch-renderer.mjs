/*!
 * pixi-batch-renderer
 * Compiled Tue, 07 Apr 2020 19:36:34 UTC
 *
 * pixi-batch-renderer is licensed under the MIT License.
 * http://www.opensource.org/licenses/mit-license
 */
this.PIXI = this.PIXI || {}
this.PIXI.brend = this.PIXI.brend || {}
import { TYPES, ViewableBuffer, utils, ObjectRenderer, settings, ENV, Geometry, Buffer, Shader } from 'pixi.js';

/**
 * Redirects are used to aggregate the resources needed by the WebGL pipeline to render
 * a display-object. This includes the base primitives (geometry), uniforms, and
 * textures (which are handled as "special" uniforms).
 *
 * @memberof PIXI.brend
 * @class
 * @abstract
 * @see PIXI.brend.AttributeRedirect
 */
class Redirect {
    constructor(source, glslIdentifer) {
        /**
         * The property on the display-object that holds the resource.
         *
         * Instead of a property, you can provide a callback that generates the resource
         * on invokation.
         *
         * @member {string | Function}
         */
        this.source = source;
        /**
         * The shader variable that references the resource, e.g. attribute or uniform
         * name.
         * @member {string}
         */
        this.glslIdentifer = glslIdentifer;
    }
}

/**
 * This redirect defines an attribute of a display-object's geometry. The attribute
 * data is expected to be stored in a `PIXI.ViewableBuffer`, in an array, or (if
 * just one element) as the property itself.
 *
 * @memberof PIXI.brend
 * @class
 * @extends PIXI.brend.Redirect
 * @example
 * // This attribute redirect calculates the tint used on top of a texture. Since the
 * // tintMode can change anytime, it is better to use a derived source (function).
 * //
 * // Furthermore, the color is uploaded as four bytes (`attribute vec4 aTint`) while the
 * // source returns an integer. This is done by splitting the 32-bit integer into four
 * // 8-bit bytes.
 * new PIXI.brend.AttributeRedirect(
 *     (tgt: ExampleDisplay) => (tgt.alpha < 1.0 && tgt.tintMode === PREMULTIPLY)
 *          ? premultiplyTint(tgt.rgb, tgt.alpha)
 *          : tgt.rgb + (tgt.alpha << 24);
 *     'aTint',
 *     'int32',
 *     '%notarray%',
 *     PIXI.TYPES.UNSIGNED_BYTE,
 *     4,
 *     true
 * );
 */
class AttributeRedirect extends Redirect {
    /**
     * @param {string | Function} source - redirect source
     * @param {string} glslIdentifer - shader attribute variable
     * @param {string}[type='float32'] - the type of data stored in the source
     * @param {number | '%notarray%'}[size=0] - size of the source array ('%notarray' if not an array & just one element)
     * @param {PIXI.TYPES}[glType=PIXI.TYPES.FLOAT] - data format to be uploaded in
     * @param {number} glSize - number of elements to be uploaded as (size of source and upload must match)
     * @param {boolean}[normalize=false] - whether to normalize the data before uploading
     */
    constructor(source, glslIdentifer, type = 'float32', size = 0, glType = TYPES.FLOAT, glSize, normalize = false) {
        super(source, glslIdentifer);
        /**
         * The type of data stored in the source buffer. This can be any of: `int8`, `uint8`,
         * `int16`, `uint16`, `int32`, `uint32`, or (by default) `float32`.
         *
         * @member {string}
         * @see [PIXI.ViewableBuffer#view]{@link https://pixijs.download/dev/docs/PIXI.ViewableBuffer.html}
         * @default 'float32'
         */
        this.type = type;
        /**
         * Number of elements to extract out of `source` with
         * the given view type, for one vertex.
         *
         * If source isn't an array (only one element), then
         * you can set this to `'%notarray%'`.
         *
         * @member {number | '%notarray%'}
         */
        this.size = size;
        /**
         * This is equal to `size` or 1 if size is `%notarray%`.
         *
         * @member {number}
         */
        this.properSize = (size === '%notarray%') ? 1 : size;
        /**
         * Type of attribute, when uploading.
         *
         * Normally, you would use the corresponding type for
         * the view on source. However, to speed up uploads
         * you can aggregate attribute values in larger data
         * types. For example, an RGBA vec4 (byte-sized channels)
         * can be represented as one `Uint32`, while having
         * a `glType` of `UNSIGNED_BYTE`.
         *
         * @member {PIXI.TYPES}
         */
        this.glType = glType;
        /**
         * Size of attribute in terms of `glType`.
         *
         * Note that `glSize * glType <= size * type`
         *
         * @readonly
         */
        this.glSize = glSize;
        /**
         * Whether to normalize the attribute values.
         *
         * @member {boolean}
         * @readonly
         */
        this.normalize = normalize;
    }
    static vertexSizeFor(attributeRedirects) {
        return attributeRedirects.reduce((acc, redirect) => (ViewableBuffer.sizeOf(redirect.type)
            * redirect.properSize)
            + acc, 0);
    }
}

/**
 * Used to generate discrete groups/batches of display-objects
 * that can be drawn together. It also keeps a parallel buffer
 * of textures.
 *
 * This class ensures that the WebGL states are equivalent and
 * the texture count doesn't become greater than the no. of
 * texture registers on the GPU. You can extend it and add
 * constraints by overriding `onPut`.
 *
 * WARNING: `BatchRenderer` does not support geometry
 *              packing with texture reduction disabled.
 *
 * @memberof PIXI.brend
 * @class
 */
class BatchGenerator {
    /**
     * @param {number} textureIncrement - textures per object
     * @param {number} textureLimit - no. of texture registers in GPU
     * @param {string} textureProperty - property where texture is kept
     * @param {boolean} [enableTextureReduction=true] - whether same textures
     *      aren't counted multiple times. This reduces draw calls and can
     *      draw huge amounts of objects at the same time. For example,
     *      if 1000 objects use the same texture, then they can be drawn
     *      together. Further more if 1000 object use the same 8 textures
     *      randomly, then they can be drawn together. (provided other
     *      constraints like state are satisfied.)
     */
    constructor(textureIncrement, textureLimit, textureProperty, enableTextureReduction = true) {
        /** @private */
        this._state = null;
        /** @private */
        this._textureIncrement = textureIncrement;
        /** @private */
        this._textureLimit = textureLimit;
        /** @private */
        this._textureProperty = textureProperty;
        /** @private */
        this._batchBuffer = [];
        /** @private */
        this._textureBuffer = {}; // uid : texture map
        /** @private */
        this._textureBufferLength = 0;
        /** @private */
        this._textureIndexedBuffer = []; // array of textures
        /** @private */
        this._textureIndexMap = {}; // uid : index in above
        /** @protected */
        this.enableTextureReduction = enableTextureReduction;
        // this._putTexture is used to handle texture buffering!
        if (enableTextureReduction) {
            if (textureIncrement === 1) {
                /** @private */
                this._putTexture = this._putOnlyTexture;
            }
            else {
                this._putTexture = this._putTextureArray;
            }
        }
        else if (textureIncrement === 1) {
            this._putTexture = this._putTextureWithoutReduction;
        }
        else {
            this._putTexture = this._putTextureArrayWithoutReduction;
        }
    }
    /**
     * Overridable method that is called before an object
     * is put into this batch. It should check compatibility
     * with other objects, and return true/false accordingly.
     *
     * @param targetObject {PIXI.DisplayObject} - object being added
     * @protected
     */
    onPut(targetObject) {
        return true;
    }
    /**
     * Put an object into this batch.
     *
     * @param targetObject {PIXI.DisplayObject} - object to add
     * @param state {PIXI.State} - state required by that object
     * @return {boolean} whether the object was added to the
     *     batch. If it wasn't, you should finalize it.
     */
    put(targetObject, state) {
        if (!this._state) {
            this._state = state;
        }
        else if (this._state.data !== state.data) {
            return false;
        }
        if (!this.onPut(targetObject)) {
            return false;
        }
        if (this._textureIncrement > 0
            && !this._putTexture(targetObject[this._textureProperty])) {
            return false;
        }
        this._batchBuffer.push(targetObject);
        return true;
    }
    /**
     * Finalize this batch by getting its data into a
     * `Batch` object.
     *
     * @param batch {PIXI.brend.Batch}
     */
    finalize(batch) {
        batch.batchBuffer = this._batchBuffer;
        batch.textureBuffer = this._textureIndexedBuffer;
        batch.uidMap = this.enableTextureReduction
            ? this._textureIndexMap : null;
        batch.state = this._state;
        this._state = null;
        this._batchBuffer = [];
        this._textureBuffer = {};
        this._textureIndexMap = {};
        this._textureBufferLength = 0;
        this._textureIndexedBuffer = [];
    }
    _putOnlyTexture(texture) {
        if (texture.baseTexture) {
            texture = texture.baseTexture;
        }
        const baseTexture = texture;
        if (this._textureBuffer[baseTexture.uid]) {
            return true;
        }
        else if (this._textureBufferLength + 1 <= this._textureLimit) {
            this._textureBuffer[baseTexture.uid] = texture;
            this._textureBufferLength += 1;
            const newLength = this._textureIndexedBuffer.push(baseTexture);
            const index = newLength - 1;
            this._textureIndexMap[baseTexture.uid] = index;
            return true;
        }
        return false;
    }
    _putTextureArray(textureArray) {
        let deltaBufferLength = 0;
        for (let i = 0; i < textureArray.length; i++) {
            const texture = textureArray[i].baseTexture
                ? textureArray[i].baseTexture
                : textureArray[i];
            if (!this._textureBuffer[texture.uid]) {
                ++deltaBufferLength;
            }
        }
        if (deltaBufferLength + this._textureBufferLength > this._textureLimit) {
            return false;
        }
        for (let i = 0; i < textureArray.length; i++) {
            const texture = textureArray[i].baseTexture
                ? textureArray[i].baseTexture
                : textureArray[i];
            if (!this._textureBuffer[texture.uid]) {
                this._textureBuffer[texture.uid] = texture;
                this._textureBufferLength += 1;
                const newLength = this._textureIndexedBuffer.push(texture);
                const index = newLength - 1;
                this._textureIndexMap[texture.uid] = index;
            }
        }
        return true;
    }
    _putTextureWithoutReduction(texture) {
        if (texture.baseTexture) {
            texture = texture.baseTexture;
        }
        if (this._textureBufferLength + 1 > this._textureLimit) {
            return false;
        }
        this._textureIndexedBuffer.push(texture);
        return true;
    }
    _putTextureArrayWithoutReduction(textureArray) {
        if (this._textureBufferLength + textureArray.length
            > this._textureLimit) {
            return false;
        }
        for (let i = 0; i < textureArray.length; i++) {
            this._textureIndexedBuffer.push(textureArray[i].baseTexture
                ? textureArray[i].baseTexture
                : textureArray[i]);
        }
        return true;
    }
}

/**
 * Resources that need to be uploaded to WebGL to render
 * one batch.
 *
 * @memberof PIXI.brend
 * @class
 */
class Batch {
    constructor(geometryOffset) {
        /**
         * Offset in the geometry (set by `BatchRenderer`)
         * where this batch is located.
         *
         * @member {number}
         */
        this.geometryOffset = geometryOffset;
        /**
         * Buffer of textures that should be uploaded in-order
         * to GPU texture registers.
         *
         * @member {Array<PIXI.Texture>}
         */
        this.textureBuffer = null;
        /**
         * Map of texture-ids into texture-buffer indices.
         *
         * @member {Map<number, number>}
         */
        this.uidMap = null;
        /**
         * State required to render this batch.
         *
         * @member {PIXI.State}
         */
        this.state = null;
    }
    /**
     * Uploads the resources required before rendering this
     * batch.
     */
    upload(renderer) {
        this.textureBuffer.forEach((tex, i) => {
            renderer.texture.bind(tex, i);
        });
        renderer.state.set(this.state);
    }
    /**
     * Resets all properties to `null` to free up references
     * to resources.
     */
    reset() {
        this.textureBuffer
            = this.uidMap
                = this.state
                    = null;
    }
}

const CompilerConstants = {
    INDICES_OFFSET: '__offset_indices_',
    FUNC_SOURCE_BUFFER: 'getSourceBuffer',
    packerArguments: [
        'targetObject',
        'compositeAttributes',
        'compositeIndices',
        'aIndex',
        'iIndex',
        'textureId',
        'attributeRedirects',
    ],
};
/**
 * Packs the geometry of display-object batches into a
 * composite attribute and index buffer.
 *
 * It works by generating an optimized packer function,
 * which can add objects to the composite geometry. This
 * geometry is interleaved and is in accordance with
 * what {@link PIXI.brend.BatchRenderer.generateCompositeGeometry}
 * would return.
 *
 * @memberof PIXI.brend
 * @class
 */
class GeometryPacker {
    /**
     * @param {PIXI.brend.AttributeRedirect[]} attributeRedirects
     * @param {string} indexProperty - property where indicies are
     *     kept; null/undefined if not required.
     * @param {string | number} vertexCountProperty - property where
     *      no. of vertices for each object are kept. This could also
     *      be a constant.
     * @param {number} vertexSize - vertex size, calculated by
     *     default. This should exclude the vertex attribute
     * @param {number} texturePerObject - no. of textures per object
     */
    constructor(attributeRedirects, indexProperty, vertexCountProperty, vertexSize = AttributeRedirect.vertexSizeFor(attributeRedirects), texturePerObject) {
        vertexSize += texturePerObject * 4; // texture indices are also passed
        this._targetCompositeAttributeBuffer = null;
        this._targetCompositeIndexBuffer = null;
        this._aIndex = 0;
        this._iIndex = 0;
        this._attributeRedirects = attributeRedirects;
        this._indexProperty = indexProperty;
        this._vertexCountProperty = vertexCountProperty;
        this._vertexSize = vertexSize;
        this._texturePerObject = texturePerObject;
        this._aBuffers = []; // @see _getAttributeBuffer
        this._iBuffers = []; // @see _getIndexBuffer
    }
    /**
     * A generated function that will append an object's
     * attributes and indices to composite buffers.
     *
     * The composite attribute buffer is interleaved.
     *
     * The composite index buffer has adjusted indices. It
     * accounts for the new positions of vertices in the
     * composite attribute buffer.
     *
     * You can overwrite this property with a custom packer
     * function.
     *
     * @member {PIXI.brend.PackerFunction}
     */
    get packerFunction() {
        if (!this._packerFunction) {
            this._packerFunction
                = new FunctionCompiler(this).compile(); // eslint-disable-line
        }
        return this._packerFunction;
    }
    set packerFunction(func) {
        this._packerFunction = func;
    }
    /**
     * This is the currently active composite attribute
     * buffer. It may contain garbage in unused locations.
     *
     * @member {PIXI.ViewableBuffer}
     */
    get compositeAttributes() {
        return this._targetCompositeAttributeBuffer;
    }
    /**
     * This is the currently active composite index
     * buffer. It may contain garbage in unused locations.
     *
     * It will be `null` if `indexProperty` was not given.
     *
     * @member {Uint16Array}
     */
    get compositeIndices() {
        return this._targetCompositeIndexBuffer;
    }
    /**
     * @param {number} batchVertexCount
     * @param {number} batchIndexCount
     */
    reset(batchVertexCount, batchIndexCount) {
        this._targetCompositeAttributeBuffer
            = this.getAttributeBuffer(batchVertexCount);
        if (this._indexProperty) {
            this._targetCompositeIndexBuffer
                = this.getIndexBuffer(batchIndexCount);
        }
        this._aIndex = this._iIndex = 0;
    }
    /**
     * @param {PIXI.DisplayObject} targetObject
     * @param {number} textureId
     */
    pack(targetObject, textureId) {
        this.packerFunction(targetObject, this._targetCompositeAttributeBuffer, this._targetCompositeIndexBuffer, this._aIndex, this._iIndex, textureId, this._attributeRedirects);
    }
    getAttributeBuffer(size) {
        // 8 vertices is enough for 2 quads
        const roundedP2 = utils.nextPow2(Math.ceil(size / 8));
        const roundedSizeIndex = utils.log2(roundedP2);
        const roundedSize = roundedP2 * 8;
        if (this._aBuffers.length <= roundedSizeIndex) {
            this._aBuffers.length = roundedSizeIndex + 1;
        }
        let buffer = this._aBuffers[roundedSizeIndex];
        if (!buffer) {
            this._aBuffers[roundedSize] = buffer
                = new ViewableBuffer(roundedSize * this._vertexSize);
        }
        return buffer;
    }
    getIndexBuffer(size) {
        // 12 indices is enough for 2 quads
        const roundedP2 = utils.nextPow2(Math.ceil(size / 12));
        const roundedSizeIndex = utils.log2(roundedP2);
        const roundedSize = roundedP2 * 12;
        if (this._iBuffers.length <= roundedSizeIndex) {
            this._iBuffers.length = roundedSizeIndex + 1;
        }
        let buffer = this._iBuffers[roundedSizeIndex];
        if (!buffer) {
            this._iBuffers[roundedSizeIndex] = buffer
                = new Uint16Array(roundedSize);
        }
        return buffer;
    }
}
// FunctionCompiler was intented to be a static inner
// class in GeometryPacker. However, due to a bug in
// JSDoc (3.6.3), I've put it down here :)
//
// https://github.com/jsdoc/jsdoc/issues/1673
const FunctionCompiler = class {
    /**
     * @param {PIXI.brend.GeometryPacker} packer
     */
    constructor(packer) {
        this.packer = packer;
    }
    compile() {
        const packer = this.packer;
        let packerBody = ``;
        /* Source offset variables for attribute buffers &
            the corresponding buffer-view references. */
        packer._attributeRedirects.forEach((redirect, i) => {
            packerBody += `
                let __offset_${i} = 0;
                const __buffer_${i} = (
                    ${this._compileSourceBufferExpression(redirect, i)});
            `;
        });
        /* Basis for the "packing" for-loop. */
        packerBody += `
            const {
                int8View,
                uint8View,
                int16View,
                uint16View,
                int32View,
                uint32View,
                float32View,
            } = compositeAttributes;

            const vertexCount = ${this._compileVertexCountExpression()};

            let adjustedAIndex = 0;

            for (let vertexIndex = 0; vertexIndex < vertexCount; vertexIndex++)
            {
        `;
        // Eliminate offset conversion when adjacent attributes
        // have similar source-types.
        let skipReverseTransformation = false;
        /* Packing for-loop body. */
        for (let i = 0; i < packer._attributeRedirects.length; i++) {
            const redirect = packer._attributeRedirects[i];
            /* Initialize adjsutedAIndex in terms of source type. */
            if (!skipReverseTransformation) {
                packerBody += `
                    adjustedAIndex = aIndex / ${this._sizeOf(i)};
                `;
            }
            if (typeof redirect.size === 'number') {
                for (let j = 0; j < redirect.size; j++) {
                    packerBody += `
                        ${redirect.type}View[adjustedAIndex++] =
                            __buffer_${i}[__offset_${i}++];
                    `;
                }
            }
            else {
                packerBody += `
                        ${redirect.type}View[adjustedAIndex++] =
                            __buffer_${i};
                `;
            }
            if (packer._attributeRedirects[i + 1]
                && (this._sizeOf(i + 1) !== this._sizeOf(i))) {
                packerBody += `
                    aIndex = adjustedAIndex * ${this._sizeOf(i)};
                `;
            }
            else {
                skipReverseTransformation = true;
            }
        }
        if (skipReverseTransformation) {
            if (this._sizeOf(packer._attributeRedirects.length - 1)
                !== 4) {
                packerBody += `
                    aIndex = adjustedAIndex * ${this._sizeOf(packer._attributeRedirects.length - 1)}
                `;
                skipReverseTransformation = false;
            }
        }
        if (packer._texturePerObject > 0) {
            if (packer._texturePerObject > 1) {
                if (!skipReverseTransformation) {
                    packerBody += `
                        adjustedAIndex = aIndex / 4;
                    `;
                }
                for (let k = 0; k < packer._texturePerObject; k++) {
                    packerBody += `
                        float32View[adjustedAIndex++] = textureId[${k}];
                    `;
                }
                packerBody += `
                    aIndex = adjustedAIndex * 4;
                `;
            }
            else if (!skipReverseTransformation) {
                packerBody += `
                    float32View[aIndex] = textureId;
                    aIndex += 4;
                `;
            }
            else {
                packerBody += `
                    float32View[adjustedAIndex++] = textureId;
                    aIndex = adjustedAIndex * 4;
                `;
            }
        }
        /* Close the packing for-loop. */
        packerBody += `}
            ${this.packer._indexProperty
            ? `const oldAIndex = this._aIndex;`
            : ''}
            this._aIndex = aIndex;
        `;
        if (this.packer._indexProperty) {
            packerBody += `
                const verticesBefore = oldAIndex / ${this.packer._vertexSize}
                const indexCount
                    = targetObject['${this.packer._indexProperty}'].length;

                for (let j = 0; j < indexCount; j++)
                {
                    compositeIndices[iIndex++] = verticesBefore +
                        targetObject['${this.packer._indexProperty}'][j];
                }

                this._iIndex = iIndex;
            `;
        }
        // eslint-disable-next-line no-new-func
        return new Function(...CompilerConstants.packerArguments, packerBody);
    }
    _compileSourceBufferExpression(redirect, i) {
        return (typeof redirect.source === 'string')
            ? `targetObject['${redirect.source}']`
            : `attributeRedirects[${i}].source(targetObject)`;
    }
    _compileVertexCountExpression() {
        if (!this.packer._vertexCountProperty) {
            // auto-calculate based on primary attribute
            return `__buffer_0.length / ${this.packer._attributeRedirects[0].size}`;
        }
        return ((typeof this.packer._vertexCountProperty === 'string')
            ? `targetObject.${this.packer._vertexCountProperty}`
            : `${this.packer._vertexCountProperty}`);
    }
    _sizeOf(i) {
        return ViewableBuffer.sizeOf(this.packer._attributeRedirects[i].type);
    }
};

function resolveConstantOrProperty(targetObject, property) {
    return (typeof property === 'string')
        ? targetObject[property]
        : property;
}

function resolveFunctionOrProperty(targetObject, property) {
    return (typeof property === 'string')
        ? targetObject[property]
        : property(targetObject);
}

/**
 * This object renderer renders multiple display-objects in batches. It can greatly
 * reduce the number of draw calls issued per frame.
 *
 * ## Batch Rendering Pipeline
 *
 * The batch rendering pipeline consists of the following stages:
 *
 * * **Display-object buffering**: Each display-object is kept in a buffer until it fills
 * up or a flush is required.
 *
 * * **Geometry compositing**: The geometries of each display-object are merged together
 * in one interleaved composite geometry.
 *
 * * **Batch accumulation**: In a sliding window, display-object batches are generated based
 * off of certain constraints like GPU texture units and the uniforms used in each display-object.
 *
 * * **Rendering**: Each batch is rendered in-order using `gl.draw*`. The textures and
 * uniforms of each display-object are uploaded as arrays.
 *
 * ## Shaders
 *
 * ### Shader templates
 *
 * Since the max. display-object count per batch is not known until the WebGL context is created,
 * shaders are generated at runtime by processing shader templates. A shader templates has "%macros%"
 * that are replaced by constants at runtime.
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
 * @memberof PIXI.brend
 * @class
 * @extends PIXI.ObjectRenderer
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
 *          renderer.plugins['ExampleBatchRenderer'].render(this);
 *     }
 * }
 */
class BatchRenderer extends ObjectRenderer {
    /**
     * Creates a batch renderer the renders display-objects with the described
     * geometry.
     *
     * To register a batch-renderer plugin, you must use the API provided by
     * `PIXI.brend.BatchRendererPluginFactory`.
     *
     * @param {PIXI.Renderer} renderer - renderer to attach to
     * @param {PIXI.brend.AttributeRedirect[]} attributeRedirects
     * @param {string | null} indexProperty
     * @param {string | number} vertexCountProperty
     * @param {string | null} textureProperty
     * @param {number} texturePerObject
     * @param {string} textureAttribute - name of texture-id attribute variable
     * @param {Function} stateFunction - returns a {PIXI.State} for an object
     * @param {Function} shaderFunction - generates a shader given this instance
     * @param {PIXI.brend.GeometryPacker} [packer=new PIXI.brend.GeometryPacker]
     * @param {Class} [BatchGeneratorClass=PIXI.brend.BatchGenerator]
     * @see PIXI.brend.ShaderGenerator
     */
    constructor(// eslint-disable-line max-params
    renderer, attributeRedirects, indexProperty, vertexCountProperty, textureProperty, texturePerObject, textureAttribute, stateFunction, shaderFunction, packer = new GeometryPacker(attributeRedirects, indexProperty, vertexCountProperty, // auto-calculate
    undefined, texturePerObject), BatchGeneratorClass = BatchGenerator) {
        super(renderer);
        this._attributeRedirects = attributeRedirects;
        this._indexProperty = indexProperty;
        this._vertexCountProperty = vertexCountProperty;
        this._textureProperty = textureProperty;
        this._texturePerObject = texturePerObject;
        this._textureAttribute = textureAttribute;
        this._stateFunction = stateFunction;
        this._shaderFunction = shaderFunction;
        this._BatchGeneratorClass = BatchGeneratorClass;
        this._batchGenerator = null; // @see this#contextChange
        // Although the runners property is not a public API, it is required to
        // handle contextChange events.
        this.renderer.runners.contextChange.add(this);
        // If the WebGL context has already been created, initialization requires a
        // syntheic call to contextChange.
        if (this.renderer.gl) {
            this.contextChange();
        }
        this._packer = packer;
        this._geom = BatchRenderer.generateCompositeGeometry(attributeRedirects, !!indexProperty, textureAttribute, texturePerObject);
        this._objectBuffer = [];
        this._bufferedVertices = 0;
        this._bufferedIndices = 0;
        this._shader = null;
        this._batchPool = []; // may contain garbage after _batchCount
        this._batchCount = 0;
    }
    /**
     * Internal method that is called whenever the renderer's WebGL context changes.
     */
    contextChange() {
        const gl = this.renderer.gl;
        if (settings.PREFER_ENV === ENV.WEBGL_LEGACY) {
            this.MAX_TEXTURES = 1;
        }
        else {
            this.MAX_TEXTURES = Math.min(gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS), settings.SPRITE_MAX_TEXTURES);
        }
        this._batchGenerator = new this._BatchGeneratorClass(this._texturePerObject, this.MAX_TEXTURES, this._textureProperty, true); // NOTE: Force texture reduction
        if (!this._batchGenerator.enableTextureReduction) {
            throw new Error('PIXI.brend.BatchRenderer does not support '
                + 'batch generation without texture reduction enabled.');
        }
    }
    /**
     * This is an internal method. It ensures that the batch renderer is ready
     * to start buffering display-objects. This is automatically invoked by the
     * renderer's batch system.
     *
     * @override
     */
    start() {
        this._objectBuffer.length = 0;
        this._bufferedVertices = 0;
        this._bufferedIndices = 0;
        this._shader = this._shaderFunction(this);
        if (this._shader.uniforms.uSamplers) {
            this._shader.uniforms.uSamplers
                = BatchRenderer.generateTextureArray(this.MAX_TEXTURES);
        }
        this.renderer.shader.bind(this._shader, false);
    }
    /**
     * Adds the display-object to be rendered in a batch.
     *
     * @param {PIXI.DisplayObject} displayObject
     * @override
     */
    render(displayObject) {
        this._objectBuffer.push(displayObject);
        this._bufferedVertices += this._vertexCountFor(displayObject);
        if (this._indexProperty) {
            this._bufferedIndices += resolveConstantOrProperty(displayObject, this._indexProperty).length;
        }
    }
    /**
     * Forces buffered display-objects to be rendered immediately. This should not
     * be called unless absolutely necessary like the following scenarios:
     *
     * * before directly rendering your display-object, to preserve render-order.
     *
     * * to do a nested render pass (calling `Renderer#render` inside a `render` method)
     *   because the PixiJS renderer is not re-entrant.
     *
     * @override
     */
    flush() {
        const { _batchGenerator: batchGenerator, _geom: geom, _packer: packer, renderer, _stateFunction: stateFunction, _textureProperty: textureProperty, _texturePerObject: texturePerObject, } = this;
        const gl = renderer.gl;
        const buffer = this._objectBuffer;
        const bufferLength = buffer.length;
        this._batchCount = 0;
        packer.reset(this._bufferedVertices, this._bufferedIndices);
        let batchStart = 0;
        // Generate batches/groups that will be drawn using just
        // one draw call.
        for (let objectIndex = 0; objectIndex < bufferLength;) {
            const target = buffer[objectIndex];
            const wasPut = batchGenerator.put(target, resolveFunctionOrProperty(target, stateFunction));
            if (!wasPut) {
                batchGenerator.finalize(this._newBatch(batchStart));
                batchStart = objectIndex;
            }
            else {
                ++objectIndex;
            }
        }
        // Generate the last batch, if required.
        if (batchGenerator._batchBuffer.length !== 0) {
            batchGenerator.finalize(this._newBatch(batchStart));
        }
        // Pack each object into the composite geometry. This is done
        // after batching, so that texture-ids are generated.
        let textureId = this._texturePerObject === 1
            ? 0
            : new Array(texturePerObject);
        for (let i = 0; i < this._batchCount; i++) // loop-per(batch)
         {
            const batch = this._batchPool[i];
            const batchBuffer = batch.batchBuffer;
            const batchLength = batchBuffer.length;
            const uidMap = batch.uidMap;
            let vertexCount = 0; // eslint-disable-line
            let indexCount = 0;
            for (let j = 0; j < batchLength; j++) // loop-per(targetObject)
             {
                const targetObject = batchBuffer[j];
                if (this._indexProperty) {
                    indexCount += resolveConstantOrProperty(targetObject, this._indexProperty).length;
                }
                else {
                    vertexCount += resolveConstantOrProperty(targetObject, this._vertexCountProperty);
                }
                // externally-defined properties for draw calls
                batch.$vertexCount = vertexCount;
                batch.$indexCount = indexCount;
                const tex = targetObject[textureProperty];
                let texUID;
                if (texturePerObject === 1) {
                    texUID = tex.baseTexture
                        ? tex.baseTexture.uid
                        : tex.uid;
                    textureId = uidMap[texUID];
                }
                else {
                    let _tex;
                    for (let k = 0; k < tex.length; k++) {
                        _tex = tex[k];
                        texUID = _tex.BaseTexture
                            ? _tex.baseTexture.uid
                            : _tex.uid;
                        textureId[k] = uidMap[texUID];
                    }
                }
                packer.pack(targetObject, textureId);
            }
        }
        // Upload the geometry
        geom.$buffer.update(packer.compositeAttributes.float32View);
        geom.getIndex().update(packer.compositeIndices);
        renderer.geometry.bind(geom);
        renderer.geometry.updateBuffers();
        // Now draw each batch
        for (let i = 0; i < this._batchCount; i++) {
            const batch = this._batchPool[i];
            batch.upload();
            if (this._indexProperty) {
                gl.drawElements(gl.TRIANGLES, batch.$indexCount, gl.UNSIGNED_SHORT, batch.geometryOffset * 2); // * 2 cause Uint16 indices
            }
            else {
                gl.drawArrays(gl.TRIANGLES, batch.geometryOffset, batch.$vertexCount); // TODO: *vertexSize
            }
            batch.reset();
        }
    }
    /**
     * Internal method that stops buffering of display-objects and flushes any existing
     * buffers.
     *
     * @override
     */
    stop() {
        if (this._bufferedVertices) {
            this.flush();
        }
    }
    _newBatch(batchStart) {
        if (this._batchCount === this._batchPool.length) {
            const batch = new Batch(batchStart);
            this._batchPool.push(batch);
            ++this._batchCount;
            return batch;
        }
        const batch = this._batchPool[this._batchCount++];
        batch.reset();
        batch.geometryOffset = batchStart;
        return batch;
    }
    _vertexCountFor(targetObject) {
        return (this._vertexCountProperty)
            ? resolveConstantOrProperty(targetObject, this._vertexCountProperty)
            : resolveFunctionOrProperty(targetObject, this._attributeRedirects[0].source).length
                / this._attributeRedirects[0].size;
    }
    /**
     * Constructs an interleaved geometry that can be used to upload a whole buffer
     * of display-object primitives at once.
     *
     * @private
     * @param {Array<PIXI.brend.AttributeRedirect>} attributeRedirects
     * @param {boolean} hasIndex - whether to include an index property
     * @param {string} textureAttribute - name of the texture-id attribute
     * @param {number} texturePerObject - no. of textures per object
     */
    static generateCompositeGeometry(attributeRedirects, hasIndex, textureAttribute, texturePerObject) {
        const geom = new Geometry();
        const attributeBuffer = new Buffer(null, false, false);
        const indexBuffer = hasIndex ? new Buffer(null, false, true) : null;
        attributeRedirects.forEach((redirect) => {
            const { glslIdentifer, glType, glSize, normalize, } = redirect;
            geom.addAttribute(glslIdentifer, attributeBuffer, glSize, normalize, glType);
        });
        if (textureAttribute && texturePerObject > 0) {
            geom.addAttribute(textureAttribute, attributeBuffer, texturePerObject, true, TYPES.FLOAT);
        }
        if (hasIndex) {
            geom.addIndex(indexBuffer);
        }
        geom.$buffer = attributeBuffer;
        // $buffer is attributeBuffer
        // getIndex() is ?indexBuffer
        return geom;
    }
    /**
     * @private
     * @param {number} count
     */
    static generateTextureArray(count) {
        const array = new Int32Array(count);
        for (let i = 0; i < count; i++) {
            array[i] = i;
        }
        return array;
    }
}

/**
 * Factory class for creating a batch-renderer.
 *
 * @memberof PIXI.brend
 * @class
 */
class BatchRendererPluginFactory {
    /**
     * Generates a fully customized `BatchRenderer` that aggregates primitives
     * and textures. This is useful for non-uniform based display-objects.
     *
     * @param {PIXI.brend.AttributeRedirect[]} attributeRedirects
     * @param {string | Array<number>} indexProperty
     * @param {string | number} vertexCountProperty
     * @param {string} textureProperty
     * @param {number} texturePerObject
     * @param {string} textureAttribute
     * @param {Function} stateFunction
     * @param {Function} shaderFunction
     * @param {PIXI.brend.GeometryPacker} [packer]
     * @param {Class} [BatchGeneratorClass]
     * @param {Class} [BatchRendererClass]
     * @static
     */
    static from(/* eslint-disable-line max-params */ attributeRedirects, indexProperty, vertexCountProperty, textureProperty, texturePerObject, textureAttribute, stateFunction, shaderFunction, packer, BatchGeneratorClass, BatchRendererClass = BatchRenderer) {
        return class extends BatchRendererClass {
            constructor(renderer) {
                super(renderer, attributeRedirects, indexProperty, vertexCountProperty, textureProperty, texturePerObject, textureAttribute, stateFunction, shaderFunction, packer, BatchGeneratorClass);
            }
        };
    }
}

// JavaScript is stupid enough not to have a replaceAll
// in String. This is a temporary solution and we should
// depend on an actually polyfill.
function _replaceAll(target, search, replacement) {
    return target.replace(new RegExp(search, 'g'), replacement);
}
function injectTexturesPerBatch(batchRenderer) {
    return `${batchRenderer.MAX_TEXTURES}`;
}
/**
 * Exposes an easy-to-use API for generating a shader function
 * for batch rendering.
 *
 * You are required to provide an injector map, which maps
 * macros to functions that return a string value for those
 * macros given a renderer.
 *
 * By default, only one injector is used - the textures per
 * batch `%texturesPerBatch%` macro. This is replaced by
 * the number of textures passed to the `uSamplers` textures
 * uniform.
 *
 * @memberof PIXI.brend
 * @class
 */
class ShaderGenerator {
    /**
     * WARNING: Do not pass `uSamplers` in your uniforms. They
     *  will be added to your shader instance directly.
     *
     * @param {string} vertexShaderTemplate
     * @param {string} fragmentShaderTemplate
     * @param {UniformGroup | Map<string, object>} uniforms
     * @param {Object.<String, PIXI.brend.InjectorFunction>} [templateInjectors]
     * @param {boolean} [disableVertexShaderTemplate=true] - turn off (true)
     *      if you aren't using macros in the vertex shader
     */
    constructor(vertexShaderTemplate, fragmentShaderTemplate, uniforms = {}, templateInjectors = {
        '%texturesPerBatch%': injectTexturesPerBatch,
    }, disableVertexShaderTemplate = true) {
        if (!templateInjectors['%texturesPerBatch%']) {
            templateInjectors['%texturesPerBatch%'] = injectTexturesPerBatch;
        }
        /** @protected */
        this._vertexShaderTemplate = vertexShaderTemplate;
        /** @protected */
        this._fragmentShaderTemplate = fragmentShaderTemplate;
        /** @protected */
        this._uniforms = uniforms;
        /** @protected */
        this._templateInjectors = templateInjectors;
        /**
         * Disable vertex shader templates to speed up shader
         * generation.
         *
         * @member {Boolean}
         */
        this.disableVertexShaderTemplate = disableVertexShaderTemplate;
        /**
         * Maps the stringifed state of the batch renderer to the
         * generated shader.
         *
         * @private
         * @member {Object.<String, PIXI.Shader>}
         */
        this._cache = {};
        /**
         * Unstringifed current state of the batch renderer.
         *
         * @private
         * @member {Object.<String, String>}
         * @see {PIXI.brend.ShaderGenerator#_generateInjectorBasedState}
         */
        this._cState = null;
    }
    /**
     * @return shader function that can be given to the batch renderer
     */
    generateFunction() {
        return (batchRenderer) => {
            const stringState = this._generateInjectorBasedState(batchRenderer);
            const cachedShader = this._cache[stringState];
            if (cachedShader) {
                return cachedShader;
            }
            return this._generateShader(stringState);
        };
    }
    _generateInjectorBasedState(batchRenderer) {
        let state = '';
        const cState = this._cState = {};
        for (const injectorMacro in this._templateInjectors) {
            const val = this._templateInjectors[injectorMacro](batchRenderer);
            state += val;
            cState[injectorMacro] = val;
        }
        return state;
    }
    _generateShader(stringState) {
        let vertexShaderTemplate = this._vertexShaderTemplate.slice(0);
        let fragmentShaderTemplate = this._fragmentShaderTemplate.slice(0);
        for (const injectorTemplate in this._cState) {
            if (!this.disableVertexShaderTemplate) {
                vertexShaderTemplate = _replaceAll(vertexShaderTemplate, injectorTemplate, this._cState[injectorTemplate]);
            }
            fragmentShaderTemplate = _replaceAll(fragmentShaderTemplate, injectorTemplate, this._cState[injectorTemplate]);
        }
        const shader = Shader.from(vertexShaderTemplate, fragmentShaderTemplate, this._uniforms);
        this._cache[stringState] = shader;
        return shader;
    }
}

/**
 * @namespace PIXI
 */
/**
 * This function type is used by `GeometryPacker#packerFunction`.
 *
 * It should add to this._aIndex and this._iIndex the number
 * of vertices and indices appended.
 *
 * @function
 * @name PackerFunction
 * @memberof PIXI.brend
 *
 * @param {PIXI.DisplayObject} targetObject - object to pack
 * @param {PIXI.ViewableBuffer} compositeAttributes
 * @param {Uint16Array} compositeIndices
 * @param {number} aIndex - Offset in the composite attribute buffer
 *      in bytes at which the object's geometry should be inserted.
 * @param {number} iIndex - Number of vertices already packed in the
 *      composite index buffer.
 * @param {Array<PIXI.brend.AttributeRedirect>} attributeRedirects
 * @return {void}
 * @see PIXI.brend.GeometryPacker#packerFunction
 */
/**
 * @function
 * @name InjectorFunction
 * @memberof PIXI.brend
 *
 * @param {PIXI.brend.BatchRenderer} batchRenderer
 * @return {string} value of the macro for this renderer
 */

export { AttributeRedirect, Batch, BatchGenerator, BatchRenderer, BatchRendererPluginFactory, GeometryPacker, Redirect, ShaderGenerator };
//# sourceMappingURL=pixi-batch-renderer.mjs.map