/* Compact BLAKE3 for the default 256-bit hash. */
const IV = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
const PERM = [2, 6, 3, 10, 7, 0, 4, 13, 1, 11, 12, 5, 9, 14, 15, 8];
const G = [[0,4,8,12],[1,5,9,13],[2,6,10,14],[3,7,11,15],[0,5,10,15],[1,6,11,12],[2,7,8,13],[3,4,9,14]];
const START = 1, END = 2, PARENT = 4, ROOT = 8;
const R = (x, n) => (x >>> n | x << (32 - n)) >>> 0;
const W = b => Array.from({ length: 16 }, (_, i) => (b[4*i] | b[4*i+1] << 8 | b[4*i+2] << 16 | b[4*i+3] << 24) >>> 0);

function compress(cv, m, counter, len, flags) {
	const s = [...cv, ...IV.slice(0, 4), counter >>> 0, Math.floor(counter / 2 ** 32), len, flags];
	for (let r = 0; r < 7; r++, m = PERM.map(i => m[i])) for (let i = 0; i < 8; i++) {
		const [a, b, c, d] = G[i], x = m[2*i], y = m[2*i+1];
		s[a] = s[a] + s[b] + x >>> 0, s[c] = s[c] + (s[d] = R(s[d] ^ s[a], 16)) >>> 0, s[b] = R(s[b] ^ s[c], 12);
		s[a] = s[a] + s[b] + y >>> 0, s[c] = s[c] + (s[d] = R(s[d] ^ s[a], 8)) >>> 0, s[b] = R(s[b] ^ s[c], 7);
	}
	for (let i = 0; i < 8; i++) s[i] ^= s[i + 8], s[i + 8] ^= cv[i];
	return s;
}

/* Hash a byte array, returning the 32-byte digest. */
export function blake3(input) {
	const stack = [];
	let output, counter = 0;
	for (let offset = 0; ; offset += 1024, counter++) {
		const data = input.subarray(offset, offset + 1024);
		/* Run the chunk, leaving its last block as the node output. */
		let i = 0, cv = IV;
		for (; i + 64 < data.length; i += 64) cv = compress(cv, W(data.subarray(i, i + 64)), counter, 64, i ? 0 : START).slice(0, 8);
		output = [cv, W(data.subarray(i)), counter, data.length - i, (i ? 0 : START) | END];
		if (offset + 1024 >= input.length) break;
		/* Merge finished chunks into the tree, then push the new chaining value. */
		cv = compress(output[0], output[1], output[2], output[3], output[4]).slice(0, 8);
		for (let total = counter + 1; total % 2 === 0; total /= 2) cv = compress(IV, [...stack.pop(), ...cv], 0, 64, PARENT).slice(0, 8);
		stack.push(cv);
	}
	while (stack.length) output = [IV, [...stack.pop(), ...compress(output[0], output[1], output[2], output[3], output[4]).slice(0, 8)], 0, 64, PARENT];
	return Uint8Array.from(compress(output[0], output[1], 0, output[3], output[4] | ROOT).slice(0, 8).flatMap(w => [w & 255, w >>> 8 & 255, w >>> 16 & 255, w >>> 24]));
}

/* Command line: bun blake3.js <file>; prints the URL-safe base64 digest. */
if (import.meta.main) console.log(Buffer.from(blake3((await import('node:fs')).readFileSync(process.argv[2]))).toString('base64url'));
