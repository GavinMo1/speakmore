import { Cost } from "./sections/Cost.jsx";
import { Demo } from "./sections/Demo.jsx";
import { Download } from "./sections/Download.jsx";
import { Features } from "./sections/Features.jsx";
import { Hero } from "./sections/Hero.jsx";
import { Models } from "./sections/Models.jsx";
import { Nav } from "./sections/Nav.jsx";
import { Privacy } from "./sections/Privacy.jsx";
import { Setup } from "./sections/Setup.jsx";
import { Speed } from "./sections/Speed.jsx";
import { Ways } from "./sections/Ways.jsx";

// 一页从上往下：首屏、口述演示，然后是"自由"的几段（识别方式、性能、模型、隐私、费用），首次引导，一排小特性，下载。
// 识别方式和模型隔开：英文的 Modes、Models 长得像，挨着容易看错
export default function App() {
  return (
    <>
      <Nav />
      <main>
        <Hero />
        <Demo />
        <Ways />
        <Speed />
        <Models />
        <Privacy />
        <Cost />
        <Setup />
        <Features />
        <Download />
      </main>
    </>
  );
}
