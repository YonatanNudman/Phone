import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { inspectJpeg, isPng, zonedTimeToUtc } from '../shared/jpeg';

const frame = (name: string) => new Uint8Array(readFileSync(`tests/fixtures/${name}`));

describe('inspectJpeg', () => {
  it('reads size and EXIF capture time from a real AXIS frame', () => {
    expect(inspectJpeg(frame('audubon-181-0.jpg'))).toEqual({ width: 352, height: 240, exifDateTime: '2026:10:07 00:26:29' });
  });
  it('reads size from a frame without EXIF', () => {
    expect(inspectJpeg(frame('cbe-720.jpg'))).toEqual({ width: 720, height: 480, exifDateTime: null });
  });
  it('rejects non-JPEG data (e.g. the PNG "being serviced" placeholder) and truncated files', () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
    expect(isPng(png)).toBe(true);
    expect(inspectJpeg(png)).toBeNull();
    expect(inspectJpeg(frame('audubon-181-0.jpg').subarray(0, 40))).toBeNull();
  });
});

describe('zonedTimeToUtc', () => {
  it('converts NYC wall-clock time (EDT and EST) to UTC', () => {
    expect(zonedTimeToUtc('2026:10:07 00:26:29')).toBe('2026-10-07T04:26:29.000Z');
    expect(zonedTimeToUtc('2026:12:01 08:00:00')).toBe('2026-12-01T13:00:00.000Z');
  });
  it('rejects malformed input', () => {
    expect(zonedTimeToUtc('yesterday')).toBeNull();
  });
});
