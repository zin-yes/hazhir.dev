import "./style.css";

const FRAME_RATE = 120;
const DEFAULT_BACKGROUND_COLOR = "#2188ad";

const canvas = document.querySelector("canvas");
const context = canvas?.getContext("2d");

//const main_element = document.getElementsByTagName("main")[0];

let mouse = {
  x: 0,
  y: 0,
  down: false,
};

canvas?.addEventListener("mousemove", (e) => {
  mouse.x = e.clientX;
  mouse.y = e.clientY;
});
canvas?.addEventListener("mousedown", () => {
  mouse.down = false;
});
canvas?.addEventListener("mouseup", () => {
  mouse.down = true;
});

function clear_background(context: CanvasRenderingContext2D) {
  context.fillStyle = DEFAULT_BACKGROUND_COLOR;
  context.fillRect(0, 0, window.innerWidth, window.innerHeight);
}

class Icon {
  element: HTMLDivElement | null;
  x: number = 0;
  y: number = 0;

  constructor() {
    this.element = document.createElement("div");
    this.element.className = "icon";

    const image_element = document.createElement("img");
    image_element.src = "/folder.png";
    const image_div_element = document.createElement("div");
    image_div_element.appendChild(image_element);

    const name_element = document.createElement("span");
    name_element.innerText = "folder name".substring(0, 12);

    this.element.appendChild(image_div_element);
    this.element.appendChild(name_element);

    this.element?.addEventListener("click", () => {
      alert("folder");
    });

    document.getElementById("icon-container")?.appendChild(this.element);
  }

  update() {}

  draw(context: CanvasRenderingContext2D) {}
}

let icons: Icon[] = [new Icon()];

function initialize(canvas: HTMLCanvasElement) {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}

function update() {
  icons.forEach((icon) => {
    icon.update();
  });
}

function draw(context: CanvasRenderingContext2D) {
  clear_background(context);
  icons.forEach((icon) => {
    icon.draw(context);
  });
}

if (canvas && context) {
  initialize(canvas);
  setInterval(() => {
    update();
    draw(context);
  }, 1000 / FRAME_RATE);
}
