import { expect, test } from 'bun:test';
import { blake3 } from './blake3.js';

/* Official BLAKE3 test vectors: a repeating 0..250 byte pattern per input length. */
const PATTERN = Buffer.from(Array.from({ length: 251 }, (_, index) => index));
const vectors = [
	[0, 'af1349b9f5f9a1a6a0404dea36dcc9499bcb25c9adc112b7cc9a93cae41f3262'],
	[1, '2d3adedff11b61f14c886e35afa036736dcd87a74d27b5c1510225d0f592e213'],
	[64, '4eed7141ea4a5cd4b788606bd23f46e212af9cacebacdc7d1f4c6dc7f2511b98'],
	[1023, '10108970eeda3eb932baac1428c7a2163b0e924c9a9e25b35bba72b28f70bd11'],
	[1024, '42214739f095a406f3fc83deb889744ac00df831c10daa55189b5d121c855af7'],
	[1025, 'd00278ae47eb27b34faecf67b4fe263f82d5412916c1ffd97c8cb7fb814b8444'],
	[2048, 'e776b6028c7cd22a4d0ba182a8bf62205d2ef576467e838ed6f2529b85fba24a'],
	[3073, '7124b49501012f81cc7f11ca069ec9226cecb8a2c850cfe644e327d22d3e1cd3'],
	[8193, 'bab6c09cb8ce8cf459261398d2e7aef35700bf488116ceb94a36d0f5f1b7bc3b'],
	[31744, '62b6960e1a44bcc1eb1a611a8d6235b6b4b78f32e7abc4fb4c6cdcce94895c47'],
];

function pattern(length) {
	const input = Buffer.alloc(length);
	for (let index = 0; index < length; index++) input[index] = PATTERN[index % PATTERN.length];
	return input;
}

for (const [length, expected] of vectors) {
	test(`hashes the ${length}-byte test vector`, () => {
		expect(Buffer.from(blake3(pattern(length))).toString('hex')).toBe(expected);
	});
}

test('returns 32 bytes', () => {
	expect(blake3(Buffer.from('lower bound'))).toHaveLength(32);
});
