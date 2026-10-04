import { createSignal } from "solid-js";

type Operator = "+" | "-" | "*" | "/";
type Calculator = {
  display: string;
  stored: number | null;
  operator: Operator | null;
  replaceDisplay: boolean;
};

const initialCalculator = (): Calculator => ({
  display: "0",
  stored: null,
  operator: null,
  replaceDisplay: false,
});

function calculate(left: number, operator: Operator, right: number): string {
  const result =
    operator === "+"
      ? left + right
      : operator === "-"
        ? left - right
        : operator === "*"
          ? left * right
          : right === 0
            ? Number.NaN
            : left / right;
  if (!Number.isFinite(result)) return "Error";
  const rounded = Number(result.toPrecision(12));
  return Object.is(rounded, -0) ? "0" : String(rounded);
}

export default function Main() {
  const [calculator, setCalculator] = createSignal(initialCalculator());

  const digit = (value: string) =>
    setCalculator((current) => {
      if (current.display === "Error" || current.replaceDisplay) {
        return { ...current, display: value, replaceDisplay: false };
      }
      if (current.display === "0") return { ...current, display: value };
      if (current.display.replace("-", "").replace(".", "").length >= 12) return current;
      return { ...current, display: current.display + value };
    });

  const decimal = () =>
    setCalculator((current) => {
      if (current.display === "Error" || current.replaceDisplay) {
        return { ...current, display: "0.", replaceDisplay: false };
      }
      return current.display.includes(".")
        ? current
        : { ...current, display: current.display + "." };
    });

  const chooseOperator = (operator: Operator) =>
    setCalculator((current) => {
      if (current.display === "Error") return initialCalculator();
      if (current.operator !== null && current.stored !== null && !current.replaceDisplay) {
        const display = calculate(current.stored, current.operator, Number(current.display));
        if (display === "Error") return { ...initialCalculator(), display, replaceDisplay: true };
        return { display, stored: Number(display), operator, replaceDisplay: true };
      }
      return { ...current, stored: Number(current.display), operator, replaceDisplay: true };
    });

  const equals = () =>
    setCalculator((current) => {
      if (current.operator === null || current.stored === null || current.display === "Error") {
        return current;
      }
      return {
        display: calculate(current.stored, current.operator, Number(current.display)),
        stored: null,
        operator: null,
        replaceDisplay: true,
      };
    });

  const toggleSign = () =>
    setCalculator((current) => {
      if (current.display === "0" || current.display === "Error") return current;
      return {
        ...current,
        display: current.display.startsWith("-")
          ? current.display.slice(1)
          : `-${current.display}`,
      };
    });

  return (
    <Column>
      <Text>{calculator().display}</Text>
      <Row>
        <Button onClick={() => setCalculator(initialCalculator())}>C</Button>
        <Button onClick={toggleSign}>+/-</Button>
        <Button onClick={() => chooseOperator("/")}>/</Button>
        <Button onClick={() => chooseOperator("*")}>*</Button>
      </Row>
      <Row>
        <Button onClick={() => digit("7")}>7</Button>
        <Button onClick={() => digit("8")}>8</Button>
        <Button onClick={() => digit("9")}>9</Button>
        <Button onClick={() => chooseOperator("-")}>-</Button>
      </Row>
      <Row>
        <Button onClick={() => digit("4")}>4</Button>
        <Button onClick={() => digit("5")}>5</Button>
        <Button onClick={() => digit("6")}>6</Button>
        <Button onClick={() => chooseOperator("+")}>+</Button>
      </Row>
      <Row>
        <Button onClick={() => digit("1")}>1</Button>
        <Button onClick={() => digit("2")}>2</Button>
        <Button onClick={() => digit("3")}>3</Button>
        <Button onClick={equals}>=</Button>
      </Row>
      <Row>
        <Button onClick={() => digit("0")}>0</Button>
        <Button onClick={decimal}>.</Button>
      </Row>
    </Column>
  );
}
