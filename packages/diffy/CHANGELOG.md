# Change Log - @pixi-pbr/diffy

This log was last generated on Sun, 28 Mar 2021 19:20:49 GMT and should not be manually modified.

## 1.1.0
Sun, 28 Mar 2021 19:20:49 GMT

### Minor changes

- Upgrade to PixiJS 6

## 1.0.9
Mon, 19 Oct 2020 00:17:18 GMT

*Version update only*

## 1.0.8
Tue, 13 Oct 2020 23:57:21 GMT

### Patches

- Reduce BufferInvalidation allocations by merging insignificant ones preliminarily.

## 1.0.7
Fri, 09 Oct 2020 22:54:02 GMT

### Patches

- Clear indices properly to prevent garbage from causing errors

## 1.0.6
Fri, 09 Oct 2020 22:28:52 GMT

### Patches

- Fix critical bug in partitioning algorithm

## 1.0.5
Sun, 30 Aug 2020 19:00:04 GMT

### Patches

- Fix crash when last node is coalesced in BufferInvalidationQueue#partition

## 1.0.4
Sun, 30 Aug 2020 18:46:13 GMT

### Patches

- Fix calculation of buffer length

## 1.0.3
Sun, 30 Aug 2020 16:04:06 GMT

### Patches

- Use Uint32Array comparision to avoid NaN, and diff only up till aIndex to prevent upload unused geometry

## 1.0.2
Sun, 30 Aug 2020 15:11:17 GMT

### Patches

- Fix memory leak in DiffGeometryFactory (specifically hackViewableBuffer was not recycling the ViewableBuffer, and created a new Float32Array buffer each time)

## 1.0.1
Sat, 29 Aug 2020 19:02:11 GMT

### Patches

- First release, fully optimized for WebGL 2!

