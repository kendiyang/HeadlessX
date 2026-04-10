import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";

const PROPERTIES_FIXTURE = [
	{ property: "window.history.length", type: "int" },
	{ property: "fonts", type: "array" },
	{ property: "fonts:spacing_seed", type: "uint" },
	{ property: "canvas:aaOffset", type: "int" },
	{ property: "canvas:aaCapOffset", type: "bool" },
];

async function createExecutableFixture(): Promise<string> {
	const tempDir = await mkdtemp(path.join(tmpdir(), "headfox-js-geoip-"));
	await writeFile(
		path.join(tempDir, "properties.json"),
		JSON.stringify(PROPERTIES_FIXTURE),
		"utf8",
	);
	return path.join(tempDir, "headfox-bin");
}

async function loadLaunchOptions({
	publicIpResult = "198.51.100.24",
}: {
	publicIpResult?: string;
} = {}) {
	vi.doMock("../src/addons.js", () => ({
		addDefaultAddons: vi.fn(async () => {}),
		confirmPaths: vi.fn(),
	}));

	const publicIP = vi.fn(async () => publicIpResult);
	vi.doMock("../src/ip.js", () => ({
		publicIP,
		validIPv4: (ip: string | false) =>
			typeof ip === "string" && /^(?:\d{1,3}\.){3}\d{1,3}$/.test(ip),
		validIPv6: (ip: string | false) =>
			typeof ip === "string" && ip.includes(":"),
	}));

	const getGeolocation = vi.fn(async (_ip: string) => ({
		asConfig: () => ({}),
	}));

	vi.doMock("../src/locale.js", () => ({
		geoipAllowed: vi.fn(),
		getGeolocation,
		handleLocales: vi.fn(),
	}));

	vi.doMock("../src/fingerprints.js", () => ({
		SUPPORTED_OS: ["linux", "macos", "windows"] as const,
		generateFingerprint: vi.fn(() => ({
			screen: {},
			navigator: {
				userAgent: "Mozilla/5.0 (Macintosh) Gecko/20100101 Firefox/135.0",
			},
		})),
		fromBrowserforge: vi.fn(() => ({})),
	}));

	vi.doMock("../src/pkgman.js", () => ({
		ensureBrowserInstalled: vi.fn(async () => "/tmp/headfox"),
		getPath: vi.fn(() => "/tmp/headfox"),
		installedVerStr: vi.fn(() => "135.0.1-beta.24"),
		launchPath: vi.fn(() => "/tmp/headfox/headfox-bin"),
		OS_NAME: "mac",
	}));

	vi.doMock("../src/warnings.js", () => ({
		LeakWarning: { warn: vi.fn() },
	}));

	const { launchOptions } = await import("../src/utils");
	return { launchOptions, publicIP, getGeolocation };
}

describe("launchOptions geoip handling", () => {
	afterEach(() => {
		vi.clearAllMocks();
		vi.resetModules();
		vi.restoreAllMocks();
	});

	test("uses explicit geoip string without calling public IP resolver", async () => {
		const executablePath = await createExecutableFixture();
		const { launchOptions, publicIP, getGeolocation } =
			await loadLaunchOptions();

		await launchOptions({
			executable_path: executablePath,
			ff_version: 135,
			headless: true,
			block_webgl: true,
			block_webrtc: true,
			geoip: "203.0.113.9",
		});

		expect(publicIP).not.toHaveBeenCalled();
		expect(getGeolocation).toHaveBeenCalledTimes(1);
		expect(getGeolocation).toHaveBeenCalledWith("203.0.113.9");
	});

	test("resolves geoip from network when geoip=true", async () => {
		const executablePath = await createExecutableFixture();
		const { launchOptions, publicIP, getGeolocation } = await loadLaunchOptions(
			{
				publicIpResult: "198.51.100.88",
			},
		);

		await launchOptions({
			executable_path: executablePath,
			ff_version: 135,
			headless: true,
			block_webgl: true,
			block_webrtc: true,
			geoip: true,
			proxy: "http://user:pass@10.0.0.1:8080",
		});

		expect(publicIP).toHaveBeenCalledTimes(1);
		expect(publicIP).toHaveBeenCalledWith(
			expect.stringContaining("10.0.0.1:8080"),
		);
		expect(getGeolocation).toHaveBeenCalledTimes(1);
		expect(getGeolocation).toHaveBeenCalledWith("198.51.100.88");
	});

	test("throws for invalid geoip string", async () => {
		const executablePath = await createExecutableFixture();
		const { launchOptions, publicIP, getGeolocation } =
			await loadLaunchOptions();

		await expect(
			launchOptions({
				executable_path: executablePath,
				ff_version: 135,
				headless: true,
				block_webgl: true,
				block_webrtc: true,
				geoip: "not-an-ip",
			}),
		).rejects.toThrow("must be `true` or a valid IP address");

		expect(publicIP).not.toHaveBeenCalled();
		expect(getGeolocation).not.toHaveBeenCalled();
	});
});
