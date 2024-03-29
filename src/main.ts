import "./style.css";

const FRAME_RATE = 120;

const NEW_PANE_OFFSET_X = 30;
const NEW_PANE_OFFSET_Y = 30;

class Pane {
  element: HTMLDivElement | null;
  x: number = 0;
  y: number = 0;
  width: number;
  height: number;

  constructor(width: number, height: number, pane_index: number) {
    this.width = width;
    this.height = height;
    this.element = document.createElement("div");
    this.element.className = "pane";

    this.x =
      window.innerWidth / 2 - this.width / 2 + pane_index * NEW_PANE_OFFSET_X;
    this.y =
      window.innerHeight / 2 - this.height / 2 + pane_index * NEW_PANE_OFFSET_Y;

    this.element.style.position = "absolute";
    this.element.style.zIndex = 2;
    this.element.style.left = `${this.x}px`;
    this.element.style.top = `${this.y}px`;
    this.element.style.width = `${this.width}px`;
    this.element.style.height = `${this.height}px`;
    this.element.addEventListener("click", () => {
      this.element?.remove();
      panes.pop();
    });

    main_element.appendChild(this.element);
  }

  update() {
    if (this.element) {
      this.element.style.left = `${this.x}px`;
      this.element.style.top = `${this.y}px`;
    }
  }
}

let panes: Pane[] = [];

class Icon {
  element: HTMLDivElement | null;
  x: number = 0;
  y: number = 0;
  width: number = 0;
  height: number = 0;
  active: boolean = false;
  grid_position: { x: number; y: number };

  constructor(grid_position: { x: number; y: number }) {
    this.grid_position = grid_position;
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

    this.element.addEventListener("click", () => {
      panes.push(
        new Pane(
          window.innerWidth * 0.8,
          window.innerHeight * 0.8,
          panes.length
        )
      );
    });

    document.getElementById("icon-container")?.appendChild(this.element);

    this.element.style.position = "absolute";

    this.width = this.element.offsetWidth;
    this.height = this.element.offsetHeight;
    this.x = 20 + this.width * this.grid_position.x + 30 * this.grid_position.x;
    this.y =
      20 + this.height * 2 * this.grid_position.y + 30 * this.grid_position.y;
    this.element.style.left = `${this.x}px`;
    this.element.style.top = `${this.y}px`;
  }

  update() {
    if (this.element) {
      const name_element = this.element.getElementsByTagName("span")[0];
      if (this.active) {
        if (name_element) {
          name_element.style.background = "black";
          name_element.style.color = "white";
        }
      } else {
        if (name_element) {
          name_element.style.background = "white";
          name_element.style.color = "black";
        }
      }
      this.element.style.left = `${this.x}px`;
      this.element.style.top = `${this.y}px`;
    }
  }
}

const canvas = document.querySelector("canvas");
const context = canvas?.getContext("2d");

const main_element = document.getElementsByTagName("main")[0];

let icons: Icon[] = [];

// This is some example code and will be removed later
for (let x = 0; x < 2; x++) {
  for (let y = 0; y < 5; y++) {
    icons.push(new Icon({ x: x, y: y }));
  }
}

let selection_box = { x: 0, y: 0, width: 100, height: 100 };

let mouse = {
  x: 0,
  y: 0,
  down: false,
};

function clear_background(context: CanvasRenderingContext2D) {
  context.clearRect(0, 0, window.innerWidth, window.innerHeight);
}

function initialize(canvas: HTMLCanvasElement) {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;

  main_element?.addEventListener("mousemove", (e) => {
    mouse.x = e.clientX;
    mouse.y = e.clientY;
  });

  main_element?.addEventListener("mousedown", (e) => {
    selection_box.x = e.clientX;
    selection_box.y = e.clientY;

    mouse.down = true;
  });

  main_element?.addEventListener("mouseleave", () => {
    mouse.down = false;
  });

  main_element?.addEventListener("mouseup", () => {
    mouse.down = false;
  });
}

function update() {
  if (mouse.down) {
    selection_box.width = mouse.x - selection_box.x;
    selection_box.height = mouse.y - selection_box.y;

    icons.forEach((icon) => {
      if (icon.element) {
        const flipped_horizontally =
          selection_box.x > selection_box.x + selection_box.width;
        const flipped_vertically =
          selection_box.y > selection_box.y + selection_box.height;

        const selection_box_left = flipped_horizontally
          ? selection_box.x + selection_box.width
          : selection_box.x;
        const selection_box_right = flipped_horizontally
          ? selection_box.x
          : selection_box.x + selection_box.width;
        const selection_box_top = flipped_vertically
          ? selection_box.y + selection_box.height
          : selection_box.y;
        const selection_box_bottom = flipped_vertically
          ? selection_box.y
          : selection_box.y + selection_box.height;

        const icon_left = icon.x;
        const icon_right = icon.x + icon.element.offsetWidth;
        const icon_top = icon.y;
        const icon_bottom = icon.y + icon.element.offsetHeight;

        icon.active =
          selection_box_left < icon_right &&
          selection_box_right > icon_left &&
          selection_box_top < icon_bottom &&
          selection_box_bottom > icon_top;
      }
    });
  }

  icons.forEach((icon) => {
    icon.update();
  });
  panes.forEach((pane) => {
    pane.update();
  });
}

function draw(context: CanvasRenderingContext2D) {
  clear_background(context);

  if (mouse.down) {
    context.lineWidth = 1;
    context.strokeRect(
      selection_box.x,
      selection_box.y,
      selection_box.width,
      selection_box.height
    );
    context.fillStyle = "rgba(0,0,0,0.1)";
    context.strokeStyle = "1px solid black";
    context.fillRect(
      selection_box.x,
      selection_box.y,
      selection_box.width,
      selection_box.height
    );
  }
}

if (canvas && context) {
  initialize(canvas);
  setInterval(() => {
    update();
    draw(context);
  }, 1000 / FRAME_RATE);
}
