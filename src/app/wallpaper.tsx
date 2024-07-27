export default function Wallpaper() {
  const imageURL = [
    "/wallpaper/eberhardgross.jpg",
    "/wallpaper/krisof.jpg",
    "/wallpaper/suissounet.jpg",
  ];

  return (
    <div
      className="w-[100vw] h-[100vh] absolute top-0 bottom-0 left-0 right-0 overflow-hidden bg-center bg-no-repeat"
      style={{
        backgroundImage: `url("${imageURL[0]}")`,
        backgroundSize: "cover",
      }}
    ></div>
  );
}
