import { describe, expect, it } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { OwnerVoiceEngine } from "./engine";
import { OwnerVoiceButton } from "./OwnerVoiceButton";
import { FakeUtterance, createTestEngine } from "./testDoubles";

describe("OwnerVoiceButton", () => {
  it("renders nothing when the screen has no useful summary", () => {
    const { engine } = createTestEngine();
    const { container } = render(
      <OwnerVoiceButton summary={null} engine={engine} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing for an empty summary", () => {
    const { engine } = createTestEngine();
    const { container } = render(
      <OwnerVoiceButton summary="   " engine={engine} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("never speaks automatically on mount", () => {
    const { engine, synth } = createTestEngine();
    render(<OwnerVoiceButton summary="ملخص الشاشة" engine={engine} />);
    expect(screen.getByRole("button", { name: "اسمع الصفحة" })).toBeInTheDocument();
    expect(synth.utterances).toHaveLength(0);
  });

  it("speaks on press, switches to stop, then to replay, then re-speaks", async () => {
    const user = userEvent.setup();
    const { engine, synth } = createTestEngine();
    render(<OwnerVoiceButton summary="ملخص الشاشة" engine={engine} />);

    await user.click(screen.getByRole("button", { name: "اسمع الصفحة" }));
    expect(synth.utterances).toHaveLength(1);
    expect(synth.utterances[0]?.text).toBe("ملخص الشاشة");
    expect(engine.getSnapshot().speaking).toBe(true);
    expect(
      screen.getByRole("button", { name: "إيقاف القراءة" }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "إيقاف القراءة" }));
    expect(engine.getSnapshot().speaking).toBe(false);
    expect(synth.cancelCount).toBeGreaterThan(0);
    expect(
      screen.getByRole("button", { name: "إعادة القراءة" }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "إعادة القراءة" }));
    expect(synth.utterances).toHaveLength(2);
    expect(engine.getSnapshot().speaking).toBe(true);
  });

  it("shows the first-read label again when the summary changes", async () => {
    const user = userEvent.setup();
    const { engine, synth } = createTestEngine();
    const { rerender } = render(
      <OwnerVoiceButton summary="ملخص أول" engine={engine} />,
    );
    await user.click(screen.getByRole("button", { name: "اسمع الصفحة" }));
    expect(
      screen.getByRole("button", { name: "إيقاف القراءة" }),
    ).toBeInTheDocument();

    // The narration finishes naturally.
    act(() => {
      synth.utterances[0]?.finish();
    });
    expect(
      screen.getByRole("button", { name: "إعادة القراءة" }),
    ).toBeInTheDocument();

    // A different screen summary resets the action to the first read.
    rerender(<OwnerVoiceButton summary="ملخص ثانٍ" engine={engine} />);
    expect(
      screen.getByRole("button", { name: "اسمع الصفحة" }),
    ).toBeInTheDocument();
  });

  it("never overlaps narrations on rapid double press", async () => {
    const user = userEvent.setup();
    const { engine, synth } = createTestEngine();
    render(<OwnerVoiceButton summary="ملخص الشاشة" engine={engine} />);
    const button = screen.getByRole("button", { name: "اسمع الصفحة" });
    await user.dblClick(button);
    // First click starts speech; the second click is now "إيقاف" — so only
    // one narration ever exists and no second utterance is queued.
    expect(synth.utterances).toHaveLength(1);
    expect(synth.cancelCount).toBeGreaterThanOrEqual(1);
    expect(engine.getSnapshot().speaking).toBe(false);
  });

  it("applies the simple speed presets", async () => {
    const user = userEvent.setup();
    const { engine } = createTestEngine();
    render(<OwnerVoiceButton summary="ملخص الشاشة" engine={engine} />);

    const fast = screen.getByRole("button", { name: "أسرع" });
    await user.click(fast);
    expect(engine.getSnapshot().rate).toBe("fast");
    expect(fast).toHaveAttribute("aria-pressed", "true");

    const slow = screen.getByRole("button", { name: "أبطأ" });
    await user.click(slow);
    expect(engine.getSnapshot().rate).toBe("slow");
    expect(slow).toHaveAttribute("aria-pressed", "true");
    expect(fast).toHaveAttribute("aria-pressed", "false");
  });

  it("disables the control and never speaks on unsupported browsers", async () => {
    const user = userEvent.setup();
    const engine = new OwnerVoiceEngine({
      synth: null,
      utteranceFactory: () => new FakeUtterance(),
    });
    render(<OwnerVoiceButton summary="ملخص الشاشة" engine={engine} />);

    const button = screen.getByRole("button", {
      name: "القراءة الصوتية غير مدعومة",
    });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-disabled", "true");
    expect(screen.queryByRole("button", { name: "أسرع" })).not.toBeInTheDocument();

    await user.click(button);
    expect(engine.getSnapshot().speaking).toBe(false);
    expect(engine.getSnapshot().lastText).toBeNull();
  });
});
