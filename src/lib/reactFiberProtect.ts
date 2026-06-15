/**
 * React Fiber Protection Runtime
 * Intercepts property enumeration on DOM Elements to hide internal React properties 
 * (like __reactFiber$ and __reactContainer$) from external cheats or scraping tools.
 * 
 * Safe for React: React itself doesn't enumerate keys to find these properties,
 * it accesses them directly via closures. External scripts/userscripts, however,
 * rely on property enumeration to discover the randomized React Fiber keys.
 */

function isBypassOrigin(): boolean {
	if (typeof window === "undefined") return true;
	const hn = window.location.hostname;
	return hn === "localhost" || hn === "127.0.0.1" || hn.startsWith("192.168.");
}

export function initReactFiberProtection(): void {
	if (typeof window === "undefined" || isBypassOrigin()) return;

	try {
		const originalKeys = Object.keys;
		const originalGetOwnPropertyNames = Object.getOwnPropertyNames;
		const originalOwnKeys = Reflect.ownKeys;
		const originalGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
		const originalGetOwnPropertyDescriptors = Object.getOwnPropertyDescriptors;

		const isReactInternalKey = (key: string | number | symbol): boolean => {
			return typeof key === "string" && (key.startsWith("__reactFiber$") || key.startsWith("__reactContainer$"));
		};

		const filterReactKeys = (keys: Array<string | symbol>): Array<string | symbol> => {
			return keys.filter(k => !isReactInternalKey(k));
		};

		// 1. Intercept Object.keys
		Object.keys = function (obj: any) {
			const keys = originalKeys(obj);
			if (obj instanceof Element) {
				return filterReactKeys(keys) as string[];
			}
			return keys;
		};

		// 2. Intercept Object.getOwnPropertyNames
		Object.getOwnPropertyNames = function (obj: any) {
			const keys = originalGetOwnPropertyNames(obj);
			if (obj instanceof Element) {
				return filterReactKeys(keys) as string[];
			}
			return keys;
		};

		// 3. Intercept Reflect.ownKeys
		Reflect.ownKeys = function (target: any) {
			const keys = originalOwnKeys(target);
			if (target instanceof Element) {
				return filterReactKeys(keys);
			}
			return keys;
		};

		// 4. Intercept Object.getOwnPropertyDescriptor
		Object.getOwnPropertyDescriptor = function (obj: any, prop: string | number | symbol) {
			if (obj instanceof Element && isReactInternalKey(prop)) {
				return undefined;
			}
			return originalGetOwnPropertyDescriptor(obj, prop);
		};

		// 5. Intercept Object.getOwnPropertyDescriptors
		Object.getOwnPropertyDescriptors = function (obj: any) {
			const descriptors = originalGetOwnPropertyDescriptors(obj);
			if (obj instanceof Element) {
				const cleanDescriptors: any = {};
				for (const key of originalOwnKeys(descriptors)) {
					if (!isReactInternalKey(key)) {
						cleanDescriptors[key] = (descriptors as any)[key];
					}
				}
				return cleanDescriptors;
			}
			return descriptors;
		};

		console.debug("React Fiber internal state protection active.");
	} catch (err) {
		console.error("Failed to initialize React Fiber internal protection:", err);
	}
}
