import { describe, expect, it } from "vitest";
import { checkImageLink, isPrivateAddress, webpFileName } from "./link";

describe("checkImageLink", () => {
  it("takes a public https link and drops its #fragment", () => {
    const check = checkImageLink("  https://upload.wikimedia.org/wikipedia/commons/a/a9/Example.jpg#top ");
    expect(check.ok && check.url.href).toBe("https://upload.wikimedia.org/wikipedia/commons/a/a9/Example.jpg");
  });

  it.each([
    ["http://example.com/a.png", "https://"],
    ["ftp://example.com/a.png", "https://"],
    ["not a link", "web address"],
    ["", "full address"],
    ["https://user:pw@example.com/a.png", "user name"],
    ["https://example.com:8443/a.png", "ports"],
    ["https://127.0.0.1/a.png", "IP address"],
    ["https://[::1]/a.png", "IP address"],
    ["https://169.254.169.254/latest/meta-data", "IP address"],
    ["https://localhost/a.png", "public internet"],
    ["https://printer.local/a.png", "public internet"],
    ["https://intranet/a.png", "public internet"],
    ["https://db.internal/a.png", "public internet"],
  ])("refuses %s", (link, reason) => {
    const check = checkImageLink(link);
    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.reason).toContain(reason);
  });
});

describe("isPrivateAddress", () => {
  it.each(["10.0.0.1", "127.0.0.1", "172.16.5.4", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1", "::1", "fd00::1", "fe80::1", "::ffff:10.0.0.1"])(
    "%s is private",
    (address) => expect(isPrivateAddress(address)).toBe(true),
  );
  it.each(["8.8.8.8", "151.101.1.69", "2606:4700::1111", "::ffff:8.8.8.8"])("%s is public", (address) =>
    expect(isPrivateAddress(address)).toBe(false),
  );
});

describe("webpFileName", () => {
  it("names the file after the picture", () => {
    expect(webpFileName("/wikipedia/commons/a/a9/Example.jpg")).toBe("Example.webp");
    expect(webpFileName("Screenshot 2026-10-14 at 21.04.png")).toBe("Screenshot-2026-10-14-at-21-04.webp");
    expect(webpFileName("/photos/%D0%BA%D0%BE%D1%82.jpeg")).toBe("picture.webp");
    expect(webpFileName(undefined)).toBe("picture.webp");
  });
});
