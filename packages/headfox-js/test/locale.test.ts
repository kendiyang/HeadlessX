import { describe, expect, test } from "vitest";
import { handleLocale, handleLocales } from "../src/locale";

describe("locale selection", () => {
	test("resolves region input to a locale in that region", () => {
		const locale = handleLocale("US");
		expect(locale.asString().endsWith("-US")).toBe(true);
	});

	test("resolves language-only input to a language-region locale", () => {
		const locale = handleLocale("en");
		expect(locale.asString()).toMatch(/^[a-z]{2,3}-[A-Z]{2}$/);
	});

	test("applies locale list into config fields", () => {
		const config: Record<string, unknown> = {};
		handleLocales("fr-FR,en", config);

		expect(config["locale:language"]).toBe("fr");
		expect(config["locale:region"]).toBe("FR");
		expect(config["locale:all"]).toContain("fr-FR");
		expect(config["locale:all"]).toContain("en");
	});
});
