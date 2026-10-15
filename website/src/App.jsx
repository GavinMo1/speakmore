import { Cost } from "./sections/Cost.jsx";
import { Demo } from "./sections/Demo.jsx";
import { Download } from "./sections/Download.jsx";
import { Hero } from "./sections/Hero.jsx";
import { How } from "./sections/How.jsx";
import { Look } from "./sections/Look.jsx";
import { Nav } from "./sections/Nav.jsx";
import { Privacy } from "./sections/Privacy.jsx";

export default function App() {
  return (
    <>
      <Nav />
      <main>
        <Hero />
        <Demo />
        <How />
        <Look />
        <Cost />
        <Privacy />
        <Download />
      </main>
    </>
  );
}
