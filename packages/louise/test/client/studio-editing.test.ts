import { afterEach, describe, expect, it, vi } from "vitest";
import {
  describeUploadFailures,
  settledSelect,
  unsavedChanges,
  uploadMediaFiles,
} from "../../src/client/studio/index.js";

// Ported from a client site's studio (louise/upload.ts, studio/unsaved.ts,
// studio/settled-select.ts), each written after a real loss: uploads that
// vanished without a word, edits dropped by Back, and a status that logged
// every option it was arrowed through.

afterEach(() => vi.unstubAllGlobals());

describe("uploadMediaFiles", () => {
  function stubUploads(answer: (name: string) => Response | Promise<Response>) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) =>
        answer(((init.body as FormData).get("file") as File).name),
      ),
    );
  }
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
  const file = (name: string) => new File(["x"], name);

  it("keeps every outcome, and reports uploads as they land", async () => {
    stubUploads((name) =>
      name === "bad.jpg" ? json({ error: "Too large" }, 413) : json({ url: `/m/${name}` }),
    );
    const landed: string[] = [];
    const out = await uploadMediaFiles([file("a.jpg"), file("bad.jpg"), file("b.jpg")], {
      onUploaded: (url) => landed.push(url),
    });
    expect(out.uploaded.map((u) => u.url)).toEqual(["/m/a.jpg", "/m/b.jpg"]);
    expect(out.failed.map((f) => [f.file.name, f.error])).toEqual([["bad.jpg", "Too large"]]);
    expect(landed).toEqual(["/m/a.jpg", "/m/b.jpg"]);
  });

  it("names the status when the server gives no reason, and survives a network error", async () => {
    stubUploads((name) =>
      name === "net.jpg" ? Promise.reject(new Error("offline")) : new Response("", { status: 500 }),
    );
    const out = await uploadMediaFiles([file("x.jpg"), file("net.jpg")]);
    expect(out.failed.map((f) => f.error)).toEqual(["Upload failed (500)", "offline"]);
  });

  it("posts to a custom endpoint", async () => {
    const mock = vi.fn(async (_url: string, _init?: RequestInit) => json({ url: "/m/a.jpg" }));
    vi.stubGlobal("fetch", mock);
    await uploadMediaFiles([file("a.jpg")], { endpoint: "/api/other/media" });
    expect(mock.mock.calls[0]?.[0]).toBe("/api/other/media");
  });
});

describe("describeUploadFailures", () => {
  const f = (name: string) => new File([""], name);
  it("is null when nothing failed", () => {
    expect(
      describeUploadFailures({ uploaded: [{ file: f("a"), url: "/a" }], failed: [] }),
    ).toBeNull();
  });
  it("names every failure, with a count when there were several files", () => {
    expect(
      describeUploadFailures({
        uploaded: [{ file: f("a.jpg"), url: "/a" }],
        failed: [
          { file: f("b.jpg"), error: "Too large" },
          { file: f("c.txt"), error: "Not an image" },
        ],
      }),
    ).toBe("2 of 3 didn’t upload: b.jpg (Too large); c.txt (Not an image).");
    expect(
      describeUploadFailures({ uploaded: [], failed: [{ file: f("b.jpg"), error: "Too large" }] }),
    ).toBe("Couldn’t upload b.jpg (Too large).");
  });
});

describe("unsavedChanges", () => {
  it("is dirty only when the payload differs from when it opened", () => {
    const form = { title: "Basking" };
    const guard = unsavedChanges(() => ({ ...form }));
    expect(guard.dirty()).toBe(false);
    form.title = "Basking!";
    expect(guard.dirty()).toBe(true);
    form.title = "Basking"; // typed then deleted—not a change
    expect(guard.dirty()).toBe(false);
  });

  it("counts a dirtiness the snapshot can't see", () => {
    let docDirty = false;
    const guard = unsavedChanges(() => ({}), { alsoDirty: () => docDirty });
    docDirty = true;
    expect(guard.dirty()).toBe(true);
  });

  it("leave() asks only when dirty, and goes only when confirmed", () => {
    const form = { title: "a" };
    const confirm = vi.fn(() => false);
    const guard = unsavedChanges(() => ({ ...form }), { confirm });
    const go = vi.fn();
    guard.leave(go);
    expect(confirm).not.toHaveBeenCalled();
    expect(go).toHaveBeenCalledTimes(1);

    form.title = "b";
    guard.leave(go);
    expect(confirm).toHaveBeenCalledWith("You have unsaved changes. Leave without saving?");
    expect(go).toHaveBeenCalledTimes(1); // declined

    confirm.mockReturnValue(true);
    guard.leave(go);
    expect(go).toHaveBeenCalledTimes(2);
  });

  it("shouldBlock() is true only when dirty AND the user stays", () => {
    const form = { title: "a" };
    const confirm = vi.fn(() => false);
    const guard = unsavedChanges(() => ({ ...form }), { confirm, message: "Discard?" });
    expect(guard.shouldBlock()).toBe(false);
    form.title = "b";
    expect(guard.shouldBlock()).toBe(true);
    expect(confirm).toHaveBeenCalledWith("Discard?");
    confirm.mockReturnValue(true);
    expect(guard.shouldBlock()).toBe(false);
  });

  it("markSaved() re-baselines, so a saved form is clean without closing", () => {
    const form = { title: "a" };
    const guard = unsavedChanges(() => ({ ...form }));
    form.title = "b";
    guard.markSaved();
    expect(guard.dirty()).toBe(false);
  });

  it("watchUnload() prompts on unload only while dirty, and detaches", () => {
    const form = { title: "a" };
    const guard = unsavedChanges(() => ({ ...form }));
    const detach = guard.watchUnload();
    const unload = () => {
      const e = new Event("beforeunload", { cancelable: true }) as BeforeUnloadEvent;
      window.dispatchEvent(e);
      return e.defaultPrevented;
    };
    expect(unload()).toBe(false);
    form.title = "b";
    expect(unload()).toBe(true);
    detach();
    expect(unload()).toBe(false);
  });
});

describe("settledSelect", () => {
  const select = (value: string) => {
    const el = document.createElement("select");
    el.innerHTML = ["new", "replied", "quoted", "won"]
      .map((v) => `<option value="${v}">${v}</option>`)
      .join("");
    el.value = value;
    return el;
  };
  const change = (el: HTMLSelectElement, value: string) => {
    el.value = value;
    const e = new Event("change");
    Object.defineProperty(e, "currentTarget", { value: el });
    return e;
  };

  it("saves a pointer pick at once", () => {
    const commit = vi.fn();
    const h = settledSelect(commit);
    const el = select("new");
    h.onPointerDown();
    h.onChange(change(el, "won"));
    expect(commit).toHaveBeenCalledWith("won");
  });

  it("holds arrow-key steps and saves only the settled choice, on Enter", () => {
    const commit = vi.fn();
    const h = settledSelect(commit);
    const el = select("new");
    for (const v of ["replied", "quoted", "won"]) {
      h.onKeyDown(new KeyboardEvent("keydown", { key: "ArrowDown" }));
      h.onChange(change(el, v));
    }
    expect(commit).not.toHaveBeenCalled();
    h.onKeyDown(new KeyboardEvent("keydown", { key: "Enter" }));
    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledWith("won");
  });

  it("commits a held keyboard choice on blur, once", () => {
    const commit = vi.fn();
    const h = settledSelect(commit);
    const el = select("new");
    h.onKeyDown(new KeyboardEvent("keydown", { key: "ArrowDown" }));
    h.onChange(change(el, "replied"));
    h.onBlur();
    h.onBlur();
    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledWith("replied");
  });
});
