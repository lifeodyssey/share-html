import { render, screen } from "@testing-library/react";
import React from "react";
import { test, expect } from "vitest";

function Greeting({ name }: { name: string }) {
  return <p data-testid="greeting">Hello, {name}!</p>;
}

test("renders a component into the document", () => {
  render(<Greeting name="World" />);
  expect(screen.getByTestId("greeting")).toBeDefined();
  expect(document.body.textContent).toContain("Hello, World!");
});
