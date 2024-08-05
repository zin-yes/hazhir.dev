"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { forwardRef, useEffect, useRef, useState } from "react";

import evaluatex from "evaluatex/dist/evaluatex";

export default function CalculatorApplication() {
  const [inputFieldValue, setInputFieldValue] = useState<string>("");
  const inputFieldRef = useRef<MathViewRef>(null);

  const keyPressCallback = (key: string) => {
    switch (key) {
      case "0":
        inputFieldRef.current?.setValue("0", {
          insertionMode: "insertAfter",
        });

        if (inputFieldRef.current) {
          setInputFieldValue(
            inputFieldRef.current.getValue("ascii-math").replaceAll("⋅", "*")
          );
        }

        break;
      case "1":
        inputFieldRef.current?.setValue("1", {
          insertionMode: "insertAfter",
        });

        if (inputFieldRef.current) {
          setInputFieldValue(
            inputFieldRef.current.getValue("ascii-math").replaceAll("⋅", "*")
          );
        }
        break;
      case "2":
        inputFieldRef.current?.setValue("2", {
          insertionMode: "insertAfter",
        });

        if (inputFieldRef.current) {
          setInputFieldValue(
            inputFieldRef.current.getValue("ascii-math").replaceAll("⋅", "*")
          );
        }
        break;
      case "3":
        inputFieldRef.current?.setValue("3", {
          insertionMode: "insertAfter",
        });

        if (inputFieldRef.current) {
          setInputFieldValue(
            inputFieldRef.current.getValue("ascii-math").replaceAll("⋅", "*")
          );
        }
        break;
      case "4":
        inputFieldRef.current?.setValue("4", {
          insertionMode: "insertAfter",
        });

        if (inputFieldRef.current) {
          setInputFieldValue(
            inputFieldRef.current.getValue("ascii-math").replaceAll("⋅", "*")
          );
        }
        break;
      case "5":
        inputFieldRef.current?.setValue("5", {
          insertionMode: "insertAfter",
        });

        if (inputFieldRef.current) {
          setInputFieldValue(
            inputFieldRef.current.getValue("ascii-math").replaceAll("⋅", "*")
          );
        }
        break;
      case "6":
        inputFieldRef.current?.setValue("6", {
          insertionMode: "insertAfter",
        });

        if (inputFieldRef.current) {
          setInputFieldValue(
            inputFieldRef.current.getValue("ascii-math").replaceAll("⋅", "*")
          );
        }
        break;
      case "7":
        inputFieldRef.current?.setValue("7", {
          insertionMode: "insertAfter",
        });

        if (inputFieldRef.current) {
          setInputFieldValue(
            inputFieldRef.current.getValue("ascii-math").replaceAll("⋅", "*")
          );
        }
        break;
      case "8":
        inputFieldRef.current?.setValue("8", {
          insertionMode: "insertAfter",
        });

        if (inputFieldRef.current) {
          setInputFieldValue(
            inputFieldRef.current.getValue("ascii-math").replaceAll("⋅", "*")
          );
        }
        break;
      case "9":
        inputFieldRef.current?.setValue("9", {
          insertionMode: "insertAfter",
        });

        if (inputFieldRef.current) {
          setInputFieldValue(
            inputFieldRef.current.getValue("ascii-math").replaceAll("⋅", "*")
          );
        }
        break;
      case "period":
        inputFieldRef.current?.setValue(".", {
          insertionMode: "insertAfter",
        });
        if (inputFieldRef.current) {
          setInputFieldValue(
            inputFieldRef.current.getValue("ascii-math").replaceAll("⋅", "*")
          );
        }
        break;
      case "divide":
        inputFieldRef.current?.setValue("\\frac{#@}{#?}", {
          insertionMode: "insertAfter",
        });

        if (inputFieldRef.current) {
          setInputFieldValue(
            inputFieldRef.current.getValue("ascii-math").replaceAll("⋅", "*")
          );
        }
        break;
      case "multiply":
        inputFieldRef.current?.setValue("\\cdot", {
          insertionMode: "insertAfter",
        });
        if (inputFieldRef.current) {
          setInputFieldValue(
            inputFieldRef.current.getValue("ascii-math").replaceAll("⋅", "*")
          );
        }
        break;
      case "add":
        inputFieldRef.current?.setValue("+", {
          insertionMode: "insertAfter",
        });

        if (inputFieldRef.current) {
          setInputFieldValue(
            inputFieldRef.current.getValue("ascii-math").replaceAll("⋅", "*")
          );
        }

        break;
      case "subtract":
        inputFieldRef.current?.setValue("-", {
          insertionMode: "insertAfter",
        });

        if (inputFieldRef.current) {
          setInputFieldValue(
            inputFieldRef.current.getValue("ascii-math").replaceAll("⋅", "*")
          );
        }

        break;
      case "opening_parentheses":
        inputFieldRef.current?.setValue("(", {
          insertionMode: "insertAfter",
        });

        if (inputFieldRef.current) {
          setInputFieldValue(
            inputFieldRef.current.getValue("ascii-math").replaceAll("⋅", "*")
          );
        }

        break;
      case "closing_parentheses":
        inputFieldRef.current?.setValue(")", {
          insertionMode: "insertAfter",
        });

        if (inputFieldRef.current) {
          setInputFieldValue(
            inputFieldRef.current.getValue("ascii-math").replaceAll("⋅", "*")
          );
        }

        break;
      case "clear":
        setInputFieldValue("");

        inputFieldRef.current?.setValue("", {});
        break;
      case "delete":
        inputFieldRef.current?.executeCommand("deleteBackward");

        if (inputFieldRef.current) {
          setInputFieldValue(
            inputFieldRef.current.getValue("ascii-math").replaceAll("⋅", "*")
          );
        }
        break;
      case "equals":
        if (inputFieldValue === "") break;
        try {
          const result = evaluatex(
            inputFieldRef.current
              ?.getValue("ascii-math")
              .replaceAll("⋅", "*") ?? ""
          )().toString();
          if (result === "NaN") throw Error();
          setInputFieldValue(result);

          inputFieldRef.current?.setValue(result);
        } catch {
          inputFieldRef.current?.setValue("Error");
          setInputFieldValue("Error");
        }
        break;
    }

    inputFieldRef.current?.focus();
  };

  useEffect(() => {
    if (inputFieldRef.current) {
      inputFieldRef.current.addEventListener("change", (event) => {
        setInputFieldValue(inputFieldRef.current?.getValue("ascii-math") ?? "");
        inputFieldRef.current?.focus();
      });
    }
  }, [inputFieldRef]);

  return (
    <div className="bg-card p-6 w-full h-full flex flex-col gap-4">
      <InputField ref={inputFieldRef} />
      <Keypad keyPressCallback={keyPressCallback} />
    </div>
  );
}

import MathView, { MathViewRef } from "react-math-view-locked";

const InputField = forwardRef<MathViewRef, {}>(function InputField(props, ref) {
  return (
    <MathView
      ref={ref}
      className="bg-secondary rounded-lg p-4 text-3xl font-bold text-card-foreground h-19 border-none"
    />
    // <Input
    //   onChange={(event) => {
    //     props.onValueChange(event.target.value);
    //   }}
    //   ref={ref}
    //   value={props.value}
    //   className="bg-secondary rounded-lg p-4 text-3xl font-bold text-card-foreground text-right h-19 border-none"
    // />
  );
});

function Keypad({
  keyPressCallback,
}: {
  keyPressCallback: (key: string) => void;
}) {
  return (
    <div className="grid grid-cols-4 gap-3 w-full h-full">
      <KeypadKey keyPressCallback={keyPressCallback} keyCode="clear">
        AC
      </KeypadKey>
      <KeypadKey keyPressCallback={keyPressCallback} keyCode="delete">
        DEL
      </KeypadKey>
      <KeypadKey
        keyPressCallback={keyPressCallback}
        keyCode="opening_parentheses"
      >
        (
      </KeypadKey>
      <KeypadKey
        keyPressCallback={keyPressCallback}
        keyCode="closing_parentheses"
      >
        )
      </KeypadKey>
      <KeypadKey keyPressCallback={keyPressCallback} keyCode="divide">
        {"÷"}
      </KeypadKey>
      <KeypadKey keyPressCallback={keyPressCallback} keyCode="7">
        7
      </KeypadKey>
      <KeypadKey keyPressCallback={keyPressCallback} keyCode="8">
        8
      </KeypadKey>
      <KeypadKey keyPressCallback={keyPressCallback} keyCode="9">
        9
      </KeypadKey>
      <KeypadKey keyPressCallback={keyPressCallback} keyCode="multiply">
        {"⋅"}
      </KeypadKey>
      <KeypadKey keyPressCallback={keyPressCallback} keyCode="4">
        4
      </KeypadKey>
      <KeypadKey keyPressCallback={keyPressCallback} keyCode="5">
        5
      </KeypadKey>
      <KeypadKey keyPressCallback={keyPressCallback} keyCode="6">
        6
      </KeypadKey>
      <KeypadKey keyPressCallback={keyPressCallback} keyCode="subtract">
        {"−"}
      </KeypadKey>
      <KeypadKey keyPressCallback={keyPressCallback} keyCode="1">
        1
      </KeypadKey>
      <KeypadKey keyPressCallback={keyPressCallback} keyCode="2">
        2
      </KeypadKey>
      <KeypadKey keyPressCallback={keyPressCallback} keyCode="3">
        3
      </KeypadKey>
      <KeypadKey keyPressCallback={keyPressCallback} keyCode="add">
        +
      </KeypadKey>
      <KeypadKey keyPressCallback={keyPressCallback} keyCode="0">
        0
      </KeypadKey>
      <KeypadKey keyPressCallback={keyPressCallback} keyCode="period">
        .
      </KeypadKey>
      <KeypadKey keyPressCallback={keyPressCallback} keyCode="equals">
        =
      </KeypadKey>
    </div>
  );
}

function KeypadKey({
  children,
  keyCode,
  keyPressCallback,
}: {
  children: React.ReactNode;
  keyCode: string;
  keyPressCallback: (key: string) => void;
}) {
  return (
    <Button
      className="grid-cols-1 grid-rows-1 w-full h-full"
      variant="ghost"
      onClick={() => {
        keyPressCallback(keyCode);
      }}
    >
      {children}
    </Button>
  );
}
