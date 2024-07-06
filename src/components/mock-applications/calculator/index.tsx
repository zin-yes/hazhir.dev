"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { forwardRef, useRef, useState } from "react";

export default function MockCalculatorApplication() {
  const [inputFieldValue, setInputFieldValue] = useState<string>("");
  const inputFieldRef = useRef<HTMLInputElement>(null);

  const keyPressCallback = (key: string) => {
    switch (key) {
      case "0":
        setInputFieldValue(inputFieldValue + "0");
        break;
      case "1":
        setInputFieldValue(inputFieldValue + "1");
        break;
      case "2":
        setInputFieldValue(inputFieldValue + "2");
        break;
      case "3":
        setInputFieldValue(inputFieldValue + "3");
        break;
      case "4":
        setInputFieldValue(inputFieldValue + "4");
        break;
      case "5":
        setInputFieldValue(inputFieldValue + "5");
        break;
      case "6":
        setInputFieldValue(inputFieldValue + "6");
        break;
      case "7":
        setInputFieldValue(inputFieldValue + "7");
        break;
      case "8":
        setInputFieldValue(inputFieldValue + "8");
        break;
      case "9":
        setInputFieldValue(inputFieldValue + "9");
        break;
      case "period":
        setInputFieldValue(inputFieldValue + ".");
        break;
      case "clear":
        setInputFieldValue("");
        break;
      case "delete":
        setInputFieldValue(
          inputFieldValue.substring(0, inputFieldValue.length - 1)
        );
        break;
    }

    inputFieldRef.current?.focus();
  };

  return (
    <div className="bg-card p-6 w-full h-full flex flex-col gap-4">
      <InputField
        ref={inputFieldRef}
        value={inputFieldValue}
        onValueChange={(value) => {
          setInputFieldValue(value);
        }}
      />
      <Keypad keyPressCallback={keyPressCallback} />
    </div>
  );
}

const InputField = forwardRef<
  HTMLInputElement,
  { value: string; onValueChange: (value: string) => void }
>(function InputField(props, ref) {
  return (
    <Input
      onChange={(event) => {
        props.onValueChange(event.target.value);
      }}
      ref={ref}
      value={props.value}
      className="bg-muted rounded-lg p-4 text-3xl font-bold text-card-foreground text-right h-19 border-none"
    />
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
      <KeypadKey keyPressCallback={keyPressCallback} keyCode="parentheses">
        ( )
      </KeypadKey>
      <KeypadKey keyPressCallback={keyPressCallback} keyCode="divide">
        /
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
      <KeypadKey keyPressCallback={keyPressCallback} keyCode="*">
        *
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
      <KeypadKey keyPressCallback={keyPressCallback} keyCode="-">
        -
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
      <KeypadKey keyPressCallback={keyPressCallback} keyCode="+">
        +
      </KeypadKey>
      <KeypadKey keyPressCallback={keyPressCallback} keyCode="0">
        0
      </KeypadKey>
      <KeypadKey keyPressCallback={keyPressCallback} keyCode="period">
        .
      </KeypadKey>
      <KeypadKey keyPressCallback={keyPressCallback} keyCode="exponent">
        a^n
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
