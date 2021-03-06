import { nextPow2, log2 } from '@pixi/utils';

/**
 * Pool for any array-like type.
 */
export class BufferPool<T extends ArrayLike<any>>
{
    private _bufferPools: T[][];
    private _bufferType: { new(size: number): ArrayLike<any> };

    constructor(bufferType: { new(size: number): ArrayLike<any> })
    {
        this._bufferPools = [];
        this._bufferType = bufferType;
    }

    allocateBuffer(size: number): T
    {
        const roundedP2 = nextPow2(size);
        const roundedSizeIndex = log2(roundedP2);
        const roundedSize = roundedP2;

        if (this._bufferPools.length <= roundedSizeIndex)
        {
            this._bufferPools.length = roundedSizeIndex + 1;
        }

        let bufferPool = this._bufferPools[roundedSizeIndex];

        if (!bufferPool)
        {
            this._bufferPools[roundedSizeIndex] = bufferPool = [];
        }

        return bufferPool.pop() || (new (this._bufferType)(roundedSize) as T);
    }

    releaseBuffer(buffer: T): void
    {
        const roundedP2 = nextPow2(buffer.length);
        const roundedSizeIndex = log2(roundedP2);

        if (!this._bufferPools[roundedSizeIndex])
        {
            this._bufferPools[roundedSizeIndex] = [];
        }

        this._bufferPools[roundedSizeIndex].push(buffer);
    }
}
