import { describe, expect, test } from "bun:test";
import type { NetworkInterfaceInfo } from "node:os";
import {
  getLanIpv4Address,
  isPrivateIpv4,
  normalizePublicHost,
  printLanAccess,
  renderTerminalQr,
} from "./index";

function ipv4(address: string, internal = false): NetworkInterfaceInfo {
  return {
    address,
    family: "IPv4",
    internal,
    mac: "00:00:00:00:00:00",
    netmask: "255.255.255.0",
    cidr: `${address}/24`,
  };
}

function ipv6(address: string, internal = false): NetworkInterfaceInfo {
  return {
    address,
    family: "IPv6",
    internal,
    mac: "00:00:00:00:00:00",
    netmask: "ffff:ffff:ffff:ffff::",
    cidr: `${address}/64`,
    scopeid: 0,
  };
}

describe("CLI LAN helpers", () => {
  test("isPrivateIpv4 detects private ranges and rejects invalid/link-local addresses", () => {
    expect(isPrivateIpv4("10.0.0.1")).toBe(true);
    expect(isPrivateIpv4("192.168.1.1")).toBe(true);
    expect(isPrivateIpv4("172.16.0.1")).toBe(true);
    expect(isPrivateIpv4("172.31.255.255")).toBe(true);

    expect(isPrivateIpv4("172.15.0.1")).toBe(false);
    expect(isPrivateIpv4("172.32.0.1")).toBe(false);
    expect(isPrivateIpv4("8.8.8.8")).toBe(false);
    expect(isPrivateIpv4("169.254.1.1")).toBe(false);
    expect(isPrivateIpv4("invalid")).toBe(false);
    expect(isPrivateIpv4("192.168.1.999")).toBe(false);
  });

  test("getLanIpv4Address excludes internal/link-local addresses and prefers common private LANs", () => {
    const interfaces = {
      lo0: [
        ipv4("127.0.0.1", true),
      ],
      en0: [
        ipv6("fe80::1"),
        ipv4("10.0.0.5"),
      ],
      en1: [
        ipv4("169.254.10.20"),
        ipv4("192.168.1.10"),
      ],
    } as ReturnType<typeof import("node:os").networkInterfaces>;

    expect(getLanIpv4Address(interfaces)).toBe("192.168.1.10");
  });

  test("getLanIpv4Address falls back to a non-private external IPv4", () => {
    const interfaces = {
      en0: [
        ipv4("203.0.113.10"),
      ],
    } as ReturnType<typeof import("node:os").networkInterfaces>;

    expect(getLanIpv4Address(interfaces)).toBe("203.0.113.10");
  });

  test("normalizePublicHost rejects schemes, paths, spaces, and empty values", () => {
    expect(normalizePublicHost(" dev-machine ")).toBe("dev-machine");

    expect(() => normalizePublicHost("")).toThrow("--host value must not be empty");
    expect(() => normalizePublicHost("http://dev-machine")).toThrow("without scheme");
    expect(() => normalizePublicHost("dev-machine/path")).toThrow("without scheme");
    expect(() => normalizePublicHost("dev-machine:11222")).toThrow("without scheme");
    expect(() => normalizePublicHost("dev machine")).toThrow("without scheme");
  });

  test("renderTerminalQr returns terminal output", () => {
    expect(renderTerminalQr("http://192.168.1.10:3000").length).toBeGreaterThan(0);
  });

  test("printLanAccess uses the configured public host and prints side-effect warning", () => {
    const logs: string[] = [];
    const warnings: string[] = [];

    printLanAccess(11222, {
      host: "dev-machine",
      logger: {
        log: (message) => logs.push(message),
        warn: (message) => warnings.push(message),
      },
      renderQr: (url) => `QR:${url}`,
    });

    expect(warnings).toEqual([]);
    expect(logs[0]).toBe("LAN URL: http://dev-machine:11222");
    expect(logs[1]).toContain("add/edit/delete annotations");
    expect(logs[1]).toContain("regenerate .mdr files");
    expect(logs[2]).toBe("QR:http://dev-machine:11222");
  });

  test("printLanAccess warns when no LAN host is available", () => {
    const logs: string[] = [];
    const warnings: string[] = [];

    printLanAccess(3000, {
      host: null,
      logger: {
        log: (message) => logs.push(message),
        warn: (message) => warnings.push(message),
      },
    });

    expect(logs).toEqual([]);
    expect(warnings).toEqual([
      "LAN mode enabled, but no non-internal IPv4 address was found. Skipping LAN URL and QR code.",
    ]);
  });
});
