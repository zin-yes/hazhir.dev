"use client";

import { Button } from "@/components/ui/button";
import { useRef, useState } from "react";
import dynamic from "next/dynamic";

import { MathViewRef } from "react-math-view-locked";

const MathView = dynamic(() => import("react-math-view-locked"), {
  ssr: false,
});

import evaluatex from "evaluatex/dist/evaluatex";

// TODO: Refactor this into a class, and reorganize everything so that the code is split into multiple seperate files in a new folder somewhere that is not '_apps'.

// FIXME: the SSR makes getting the ref for other calls super difficult, and having SSR enabled doesn't let the project build properly; rewrite a new & simpler calculator app from scratch, or find a different way of getting one to work with libraries.

export default function CalculatorApp() {
  const addToCurrentCalculation = (value: string) => {
    mathViewRef.current?.focus();

    const mathViewValue = mathViewRef.current?.getValue("latex");

    if (mathViewValue?.includes("\\placeholder{⬚}")) {
      mathViewRef.current?.setValue(
        mathViewValue.replace("\\placeholder{⬚}", value)
      );
    } else {
      if (mathViewValue === "error" || mathViewValue === "NaN") {
        mathViewRef.current?.setValue(value);
      } else {
        mathViewRef.current?.setValue(mathViewValue + value);
      }
    }
    mathViewRef.current?.focus();
  };

  const clearCurrentCalculation = () => {
    mathViewRef.current?.setValue("");
  };

  const deleteCharacterFromCurrentCalculation = () => {
    mathViewRef.current?.setValue(
      mathViewRef.current
        .getValue("latex")
        .substring(0, mathViewRef.current.getValue("latex").length - 1)
    );
  };

  const [calculationResult, setCalculatioResult] = useState<string>("");

  const calculateResult = () => {
    try {
      setCalculatioResult(
        evaluatex(
          (mathViewRef.current?.getValue("latex-expanded") + "").replaceAll(
            "\\cdot",
            "*"
          ),
          {},
          { latex: true }
        )({}).toString()
      );
    } catch (e) {
      setCalculatioResult("error");
    }
  };

  const runCurrentCalculation = () => {
    calculateResult();
    mathViewRef.current?.setValue(calculationResult);
  };

  const mathViewRef = useRef<MathViewRef>(null);

  return (
    <div className="bg-card p-6 w-full h-full">
      <div className="mb-6">
        <MathView
          className={`bg-muted rounded-md p-4 text-3xl font-bold text-card-foreground ${
            calculationResult == "error" ? "text-red-400" : ""
          }`}
          ref={mathViewRef}
          virtualKeyboardMode="off"
          keypressSound={null}
          onContentDidChange={(event) => {
            calculateResult();
          }}
        />
      </div>
      <div className="grid grid-cols-4 gap-3">
        <Button
          variant="ghost"
          className="text-muted-foreground"
          onClick={clearCurrentCalculation}
        >
          AC
        </Button>
        <Button
          variant="ghost"
          className="text-muted-foreground"
          onClick={deleteCharacterFromCurrentCalculation}
        >
          DEL
        </Button>

        <CalculatorButton
          addToCurrentCalculation={addToCurrentCalculation}
          value="√"
          expressionValue="\sqrt{\placeholder{⬚}}"
        />
        <CalculatorButton
          addToCurrentCalculation={() => {
            mathViewRef.current?.setValue(
              `\\frac{${mathViewRef.current.getValue(
                "latex"
              )}}{\\placeholder{⬚}}`
            );
          }}
          value="/"
        />

        <CalculatorButton
          addToCurrentCalculation={addToCurrentCalculation}
          value="7"
        />
        <CalculatorButton
          addToCurrentCalculation={addToCurrentCalculation}
          value="8"
        />
        <CalculatorButton
          addToCurrentCalculation={addToCurrentCalculation}
          value="9"
        />

        <CalculatorButton
          addToCurrentCalculation={addToCurrentCalculation}
          value="*"
          expressionValue="\cdot"
        />

        <CalculatorButton
          addToCurrentCalculation={addToCurrentCalculation}
          value="4"
        />
        <CalculatorButton
          addToCurrentCalculation={addToCurrentCalculation}
          value="5"
        />
        <CalculatorButton
          addToCurrentCalculation={addToCurrentCalculation}
          value="6"
        />

        <CalculatorButton
          addToCurrentCalculation={addToCurrentCalculation}
          value="-"
        />

        <CalculatorButton
          addToCurrentCalculation={addToCurrentCalculation}
          value="1"
        />
        <CalculatorButton
          addToCurrentCalculation={addToCurrentCalculation}
          value="2"
        />
        <CalculatorButton
          addToCurrentCalculation={addToCurrentCalculation}
          value="3"
        />

        <CalculatorButton
          addToCurrentCalculation={addToCurrentCalculation}
          value="+"
        />

        <CalculatorButton
          addToCurrentCalculation={addToCurrentCalculation}
          value="0"
        />
        <CalculatorButton
          addToCurrentCalculation={addToCurrentCalculation}
          value="."
        />
        <CalculatorButton
          addToCurrentCalculation={addToCurrentCalculation}
          value="aⁿ"
          expressionValue="^"
        />

        <Button
          variant="ghost"
          className="text-muted-foreground"
          onClick={runCurrentCalculation}
        >
          =
        </Button>
      </div>
    </div>
  );
}

function CalculatorButton({
  value,
  expressionValue,
  className,
  addToCurrentCalculation,
}: {
  value: string;
  expressionValue?: string;
  className?: string;
  addToCurrentCalculation: (value: string) => void;
}) {
  return (
    <Button
      variant="ghost"
      className={`${className} text-card-foreground`}
      onClick={() => {
        addToCurrentCalculation(expressionValue ? expressionValue : value);
      }}
    >
      {value}
    </Button>
  );
}
