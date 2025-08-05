// ==================== 1. 初始化和配置 ====================
    // 用户可调节的显示参数
    var freqMin = 0;
    var freqMax = 8000;
    var magMin = -40;
    var magMax = 40;

    var fx = false; //画面频谱出现的方向, fx=true:从右向左或从上向下, false:向右或向上
    var allowRecord = true;
    var pcScreen; //默认是电脑的显示器, 即宽度 > 长度; 而手机等是长度>宽度

    // 音频处理参数
    const sampleRate = 44100; // 采样率
    const nFFT = 1024; // FFT点数
    const overlapFactor = 0.95; // 重叠因子
    const hopSize = Math.floor(nFFT * (1 - overlapFactor)); // 步长

    // 音频缓冲区，存储最近的音频数据
    var audioBuffer = new Float32Array(nFFT * 4); // 创建 image 对象

    // 创建一个新的 Image 对象
    var img = new Image();
    // 设置图片的来源
    //img.src = "jl_logo.jpg"; // 替换为你的图片真实路径
    // 如果canvas要设置背景图, 可以:
    // 将图片绘制到 canvas 上，此处以覆盖整个 canvas 为例(这里ctx由canvas.getContext('2d');获取)
    //ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    // ==================== 2. UI 交互功能 ====================
    const btnFX = document.getElementById("btnFX");
    const sldFx = document.getElementById("slideFX");
    const sldFxMax = parseInt(sldFx.max); // 获取最大值：800
    const sldFxHalf = sldFxMax / 2; // 数值的一半：400, //滑块长度的一半
    sldFx.value = sldFxHalf; //=0;//或放到中间: =sldFxHalf
    // 方向滑块事件监听 - 动态调整图中数据出现方向-->放到变量"fx"中
    document.getElementById("slideFX").addEventListener("input", function () {
      const newWidth = parseInt(this.value); // 当前滑块数值
      fx =
        newWidth > sldFxHalf? true //滑块超过一半的位置,fx-->true
          : newWidth < sldFxHalf ? false //滑块少于一半的地方,fx-->false
          : fx; //滑块恰好在中间位置(slide正中央),保持fx的值不变
      if (newWidth < sldFxHalf) {
        btnFX.textContent = "<<FX"; // 小于中间值，显示 <FX
      } else {
        btnFX.textContent = "FX>>"; // 大于或等于中间值，显示 FX>
      }
    });

    // 控制图标切换和录音启停
    function togglePhoneTick() {
      const statusSpan = document.getElementById("recordStatus");

      if (allowRecord) {
        // 当前正在录音 →→ 停止录音
        statusSpan.innerHTML = "&#10060;"; // 显示 ❌
      } else {
        // 当前未录音 →→ 开始录音
        statusSpan.innerHTML = "&#x2705;"; // 显示 ✅
      }
      allowRecord = !allowRecord;
    }

    // 更新显示参数
    function toggleSettings() {
      var panel = document.getElementById("settingsPanel");
      var iconSpan = document.querySelector(".icon-setting"); // 获取图标元素
      if (panel.style.display === "none") {
        panel.style.display = "block"; // 或 "inline-block", "flex" 等
        iconSpan.innerHTML = "&#9650;"; // 显示 设置▲
      } else {
        panel.style.display = "none";
        iconSpan.innerHTML = "&#x23F7;"; // 显示 设置⏷
      }
    }
    function updateParams() {
      freqMin = parseFloat(document.getElementById("freqMin").value);
      freqMax = parseFloat(document.getElementById("freqMax").value);
      magMin = parseFloat(document.getElementById("magMin").value);
      magMax = parseFloat(document.getElementById("magMax").value);

      //频谱图的滚动速度
      const rollSpeed = document.getElementById("rollSpeed");
      //其实就是根据rollSpeed滑动条的值-->映射-->canvasSpectr的宽度,或 canvasRoll的高度
      const newWidth = rollSpeed.value; //800 + (value - 10) * (800 / (1200 - 10));
      canvasSpectr.width = Math.round(newWidth);
      const newHeight = rollSpeed.value; // 800 + (value - 10) * (400 / (1200 - 10));
      canvasRoll.height = Math.round(newHeight);
    }


    // ==================== 3. 数学和信号处理 ====================
    // 复数类，用于FFT计算
    class Complex {
      constructor(re, im) {
        this.re = re || 0;
        this.im = im || 0;
      }
    }

    // 快速傅里叶变换 (FFT) 算法
    // 将时域信号转换为频域信号
    function fft(signal) {
      const n = signal.length;
      if (n <= 1) return;

      // 分治法：将信号分为偶数和奇数索引的两部分
      const even = [];
      const odd = [];
      for (let i = 0; i < n / 2; i++) {
        even.push(signal[2 * i]);
        odd.push(signal[2 * i + 1]);
      }

      // 递归计算
      fft(even);
      fft(odd);

      // 合并结果
      for (let k = 0; k < n / 2; k++) {
        const t = new Complex(
          Math.cos((2 * Math.PI * k) / n) * odd[k].re -
            Math.sin((2 * Math.PI * k) / n) * odd[k].im,
          Math.sin((2 * Math.PI * k) / n) * odd[k].re +
            Math.cos((2 * Math.PI * k) / n) * odd[k].im
        );
        signal[k] = new Complex(even[k].re + t.re, even[k].im + t.im);
        signal[k + n / 2] = new Complex(even[k].re - t.re, even[k].im - t.im);
      }
    }

    // 汉宁窗函数 - 减少频谱泄漏
    // 在进行FFT前对信号加窗，使信号在边界处平滑过渡
    function applyHannWindow(arr) {
      for (let i = 0; i < arr.length; i++) {
        const win = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (arr.length - 1)));
        arr[i] *= win;
      }
    }

    // ==================== 4. 音频采集和处理 ====================
    // 启动音频采集
    async function startAudio() {
      try {
        // 创建音频上下文
        const context = new (window.AudioContext || window.webkitAudioContext)();

        // 请求麦克风权限并获取音频流
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

        // 创建音频源节点
        const source = context.createMediaStreamSource(stream);

        // 创建脚本处理器节点，用于实时处理音频数据
        const bufferSize = nFFT;
        const processor = context.createScriptProcessor(bufferSize, 1, 1);

        // 连接音频节点：麦克风 -> 处理器 -> 输出
        source.connect(processor);
        processor.connect(context.destination);

        // 音频处理回调函数 - 每当有新的音频数据时调用
        processor.onaudioprocess = function (e) {
          const input = e.inputBuffer.getChannelData(0); // 获取左声道数据

          // 更新音频缓冲区：移除最旧的数据，添加最新的数据
          audioBuffer.set(input, audioBuffer.length - input.length);
          audioBuffer = new Float32Array([
            ...audioBuffer.slice(input.length),
            ...input
          ]);
        };

        // 开始循环绘制
        drawLoop();     
      } catch (err) {
        handleAudioError(err);
      }
    }

    // ==================== 5. 可视化循环 ====================
    // 主绘制循环 - 每帧执行
    function drawLoop() {
      requestAnimationFrame(drawLoop);

      // 从缓冲区提取当前帧数据
      const frame = new Float32Array(nFFT);
      const offset = audioBuffer.length - nFFT;
      for (let i = 0; i < nFFT; i++) {
        frame[i] = audioBuffer[offset + i];
      }

      // 应用汉宁窗
      applyHannWindow(frame);

      // 准备复数数组进行FFT
      const complexFrame = [];
      for (let i = 0; i < nFFT; i++) {
        complexFrame.push(new Complex(frame[i], 0));
      }

      // 执行FFT
      fft(complexFrame);

      // 计算幅度谱（频域表示）
      const magnitude = new Float32Array(nFFT/2 + 1);
      for (let i = 0; i < magnitude.length; i++) {
        magnitude[i] = Math.sqrt(complexFrame[i].re ** 2 + complexFrame[i].im ** 2);
        magnitude[i] = 20*Math.log10(magnitude[i] + 1e-10); // 转换为分贝(dB)
      }

      // 根据屏幕方向,更新四种可视化
      // 获取容器元素1
      const container = document.querySelector(".canvas-container");
      // 获取容器元素2
      const container2= document.querySelector(".canvas-container2");
      //alert(myScreen);
      if (window.innerWidth > window.innerHeight) {
        //电脑屏幕, 不是手机屏幕 //pcScreen=true;
        if (allowRecord) {
          drawSpectHorRoll(ctxSpectr, magnitude, fx); // 走马灯频谱图left/right
          drawMagHBarPlot(ctxHLev1, magnitude, true); // 幅度-频率水平线状图
          drawMagHBarPlot(ctxHLev2, magnitude, false);
        }
        // 或者通过 ID 获取（如果该 div 有 ID）
        // const container = document.getElementById('yourDivId');
        // 隐藏容器及其所有子元素，并使其不占据空间
        container.style.display = ""; //清空就是显示
        document.getElementById("magPlot_H1").style.display = fx?"":"none";
        document.getElementById("magPlot_H2").style.display = fx?"none":"";
        //垂直频谱隐藏
        container2.style.display = "none";
        magPlot_V1.visible = false;
        spectVerRoll.visible = false;
      } else { //if(myScreen==="yes")
        //pcScreen=false;
        if (allowRecord) {
          drawMagVBarPlot(ctxMag1, magnitude, false); // 幅度-频率竖柱图top/bottom
          drawMagVBarPlot(ctxMag2, magnitude, true); // 幅度-频率竖柱图top/bottom
          drawSpectVerRoll(ctxRoll, magnitude, fx); // 瀑布图down/up
        }
        // 或者通过 ID 获取（如果该 div 有 ID）
        // const container = document.getElementById('yourDivId');
        container.style.display = "none";
        spectHorRoll.visible = false;
        magPlot_H2.visible = false;
        //垂直频谱显示
        container2.style.display = "";
        document.getElementById("magPlot_V1").style.display = fx?"none":"";
        document.getElementById("magPlot_V2").style.display = fx?"":"none";
      }
    }

    // ==================== 6. 颜色映射 ====================
    // 将归一化的值映射到彩虹色
    // norm: 0-1之间的值
    // 返回 [r, g, b] 数组
    function getColor(norm) {
      const b = Math.min(255, Math.max(0, 255 * (1.5 - Math.abs(4 * norm - 1.5))));
      const g = Math.min(255, Math.max(0, 255 * (1.5 - Math.abs(4 * norm - 2.5))));
      const r = Math.min(255, Math.max(0, 255 * (1.5 - Math.abs(4 * norm - 3.5))));
      return [r, g, b];
    }

    // ==================== 7. 四种可视化实现 ====================
    // 7.1 走马灯式频谱图
    const canvasSpectr = document.getElementById("spectHorRoll");
    const ctxSpectr = canvasSpectr.getContext("2d");

    // 在外层作用域保存上一次的 fx 值
    let prevFx = true; //根据Fx是否变化(T/F)决定是否图像翻转?

    function drawSpectHorRoll(ctx, magnitude, fx = true) {
      const width = ctx.canvas.width;
      const height = ctx.canvas.height;

      // 检查方向是否改变，如果是，则翻转整个图像
      if (fx !== prevFx) {
        // 获取完整图像数据
        const imageData = ctx.getImageData(0, 0, width, height);
        const data = imageData.data;

        // 创建新 ImageData 存放翻转后的图像
        const flippedData = ctx.createImageData(width, height);
        const flipped = flippedData.data;

        // 水平翻转：第 i 列变成 width - 1 - i 列
        // y是高度,左上角是第0行; 随着y增加,意味着1行1行的处理
        for (let y = 0; y < height; y++) {
          for (let x = 0; x < width; x++) {
            const srcIdx = 4* (y * width + x) ;
            const dstIdx = 4* (y * width + (width - 1 - x));
            flipped[dstIdx] = data[srcIdx]; // R
            flipped[dstIdx + 1] = data[srcIdx + 1]; // G
            flipped[dstIdx + 2] = data[srcIdx + 2]; // B
            flipped[dstIdx + 3] = data[srcIdx + 3]; // A
          }
        }
        // 将翻转后的图像写回画布
        ctx.putImageData(flippedData, 0, 0);

        // 更新 prevFx
        prevFx = fx;
      }

      // === 正常走马灯逻辑开始 ===
      let imageData, newPosX;
      if (fx === false) {
        // 向左滚动：图像左移一列，新列加在右边
        imageData = ctx.getImageData(1, 0, width, height);
        ctx.putImageData(imageData, 0, 0);
        newPosX = width;
      } else {
        // 向右滚动：图像右移一列，新列加在左边
        imageData = ctx.getImageData(0, 0, width, height);
        ctx.putImageData(imageData, 1, 0);
        newPosX = 1;
      }

      const newCol = newData1D(ctx,magnitude, 1, height);
      // 将新列绘制到指定位置（左或右）
      ctx.putImageData(newCol, newPosX-1, 0);
    }

    //_--_--_--_--_--_--_--_--_--_--_--_--_--_--_--_--_--_--
    // 7.2-1 幅度-频率水平横杆状图
    const canvasHLev1 = document.getElementById("magPlot_H1");
    const ctxHLev1 = canvasHLev1.getContext("2d");
    const canvasHLev2 = document.getElementById("magPlot_H2");
    const ctxHLev2 = canvasHLev2.getContext("2d");

    function drawMagHBarPlot(ctx, magnitude, fx = true) {
      const height = ctx.canvas.height;
      const width = ctx.canvas.width;
      const freqRes = sampleRate / nFFT;

      // 清空画布
      ctx.clearRect(0, 0, width, height);

      // 绘制柱状图
      const barheight = 2;
      const barGap = 1;
      const totalBars = Math.floor(height / (barheight + barGap));

      for (let i = 0; i < totalBars; i++) {
        const x = (totalBars - i) * (barheight + barGap);
        const ratio = i / totalBars;
        const freq = freqMin + ratio * (freqMax - freqMin);
        const bin = Math.floor(freq / freqRes);

        if (bin >= 0 && bin < magnitude.length) {
          const val = magnitude[bin];
          let yNorm = (val - magMin) / (magMax - magMin);
          yNorm = Math.max(0, Math.min(1, yNorm));
          const barwidth = yNorm * width;
          const [r, g, b] = getColor(yNorm);

          ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
          //let fx="top"//柱状图从底部bottom伸出来, 还是从顶部top延伸下来
          if (fx === false) ctx.fillRect(0, x, barwidth, barheight);
          //if(fx==="bottom")
          else ctx.fillRect(width - barwidth, x, barwidth, barheight);
        }
      }
      // 绘制坐标轴和标签
      drawAxes(ctx, width, height, "y=freq");
    }

    //||||||||||||||||||||||||||||||||||||||||||||||||||||||
    // 7.2-2 幅度-频率竖直的柱状图
    const canvasMag1 = document.getElementById("magPlot_V1");
    const ctxMag1 = canvasMag1.getContext("2d");
    const canvasMag2 = document.getElementById("magPlot_V2");
    const ctxMag2 = canvasMag2.getContext("2d");

    function drawMagVBarPlot(ctx, magnitude, fx = true) {
      const width = ctx.canvas.width;
      const height = ctx.canvas.height;
      const freqRes = sampleRate / nFFT;

      // 清空画布
      ctx.clearRect(0, 0, width, height);

      // 绘制柱状图
      const barWidth = 2;
      const barGap = 1;
      const totalBars = Math.floor(width / (barWidth + barGap));

      for (let i = 0; i < totalBars; i++) {
        const x = i * (barWidth + barGap);
        const ratio = i / totalBars;
        const freq = freqMin + ratio * (freqMax - freqMin);
        const bin = Math.floor(freq / freqRes);

        if (bin >= 0 && bin < magnitude.length) {
          const val = magnitude[bin];
          let yNorm = (val - magMin) / (magMax - magMin);
          yNorm = Math.max(0, Math.min(1, yNorm));
          const barHeight = yNorm * height;
          const [r, g, b] = getColor(yNorm);

          ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
          //let fx="top"//柱状图从底部bottom伸出来, 还是从顶部top延伸下来
          if (fx === true) ctx.fillRect(x, 0, barWidth, barHeight);
          //if(fx==="bottom")
          else ctx.fillRect(x, height - barHeight, barWidth, barHeight);
        }
      }

      // 绘制坐标轴和标签
      drawAxes(ctx, width, height, "y=mag");
    }

    // 绘制坐标轴辅助线
    function drawAxes(ctx, width, height, yDesc = "y=mag") {
      //y轴可选为频率轴-freq, 或为强度轴-magnitude
      ctx.strokeStyle = "white"; //线条的颜色
      ctx.lineWidth = 1;

      // 坐标轴线
      ctx.beginPath();
      ctx.moveTo(0, height - 1); //移动到左下角
      ctx.lineTo(width, height - 1); //底部X轴横线条=X,
      ctx.lineTo(width, 0); //在右边,绘制一条竖线==> Y
      ctx.stroke();

      // 文本标签的颜色, 字体
      ctx.fillStyle = "white";
      ctx.font = "11px sans-serif";
      // 设置虚线样式：4个像素的线，接着是4个像素的空隙
      ctx.setLineDash([8, 8]);
      ctx.strokeStyle = "dimGray ";//"coral"; //线条的颜色
      ctx.lineWidth = 0.5;
      ctx.beginPath();

      let xMin = freqMin, xMax = freqMax;
      let yMin = magMin,  yMax = magMax;
      if (yDesc.includes("mag")) {
        //==true包含有"mag"字样-->竖直排列
        ctx.fillText("Frequency (Hz)", width - 90, fx ? 35 : height - 35);
        ctx.fillText("Magnitude (dB)", 35, fx ? height - 10 : 10);

        ctx.moveTo(width - 1, height / 2); //移动到中间
        ctx.lineTo(0, height / 2); //在中部,绘制一条竖线
      } else {
        //if(yDesc不包含有"mag", 即Y轴是freq--->水平排列的情况
        //则须切换freq --> Y轴
        (xMin = magMin), (xMax = magMax);
        (yMin = freqMin), (yMax = freqMax);

        ctx.fillText("Frequency (Hz)", 60, 10);
        ctx.fillText("Magnitude (dB)",
          fx ? 8 : width - 80 /*根据fx方向,决定legend打印的x坐标*/,
          height - 25
        );

        ctx.moveTo(width / 2, height - 1); //移动到底部中间
        ctx.lineTo(width / 2, 0); //在中部,绘制一条竖线
      }
      ctx.stroke(); //结束绘制
      // 如果需要关闭虚线模式，可以调用 setLineDash([]) 来恢复实线
      ctx.setLineDash([]);

      // X轴刻度
      ctx.strokeStyle = "white";
      const xSteps = 10;
      for (let i = 0; i <= xSteps; i++) {
        const ratio = i / xSteps;
        let xTick = xMin + ratio * (xMax - xMin);
        xTick = fx ? -xTick : xTick; /*根据fx方向,决定数字正负*/
        const x = ratio * width;
        ctx.beginPath();
        if (yDesc.includes("mag")) {
          //==true包含有"mag"字样-->竖直排列
          ctx.moveTo(x, fx ? 5 : height - 5);
          ctx.lineTo(x, fx ? 0 : height);
          xTick = fx ? -xTick : xTick; /*根据fx方向,决定数字正负*/
          ctx.fillText( xTick.toFixed(0),
            i < xSteps ? x - 15 : x - 35,
            fx ? 18 : height - 8
          ); /*X轴数字刻度的坐标*/
        } else {
          //水平排列的情况
          ctx.moveTo(x, height - 5);
          ctx.lineTo(x, height);
          ctx.fillText( xTick.toFixed(0),
            i < xSteps ? x - 15 : x - 15,
            height - 8
          ); /*X轴数字刻度的坐标*/
        }
        ctx.stroke(); //用当前的描边样式(颜色、宽度等)实际绘制路径。
      }

      // Y轴刻度
      const ySteps = 6;
      for (let i = 1; i <= ySteps; i++) {
        const ratio = i / ySteps;
        let yTick = yMin + ratio * (yMax - yMin);
        yTick = fx ? -yTick : yTick; /*根据fx方向,决定数字正负*/
        const y = height - ratio * height;
        ctx.beginPath();
        if (yDesc.includes("mag")) {
          //==true包含有"mag"字样-->竖直排列
          ctx.moveTo(0, y); //画刻度
          ctx.lineTo(5, y);
          ctx.fillText(yTick.toFixed(0), fx ? 5 : 10, i < ySteps ? y + 4 : y + 8); //标数字
        } else {
          //水平排列的情况
          ctx.moveTo(fx ? width - 0 : 0, y); //画刻度
          ctx.lineTo(fx ? width - 5 : 5, y);
          yTick = fx ? -yTick : yTick; /*根据fx方向,决定数字正负*/
          ctx.fillText( yTick.toFixed(0),
            fx ? width - 32 : 6 /*根据fx方向,决定数字打印的x坐标*/,
            i < ySteps ? y + 4 : y + 8
          ); /*顶部的频率数值,微微下移*/
        }
        ctx.stroke(); //用当前的描边样式(颜色、宽度等)实际绘制路径。
      }
    }

    // 7.3 瀑布式频谱图
    const canvasRoll = document.getElementById("spectVerRoll");
    const ctxRoll = canvasRoll.getContext("2d");

    function drawSpectVerRoll(ctx, magnitude, fx = true) {
      const width = ctx.canvas.width;
      const height = ctx.canvas.height;

      // ======== 检测方向变化，触发上下翻转 ========
      if (fx !== prevFx) {
        // 获取完整图像数据
        const imageData = ctx.getImageData(0, 0, width, height);
        const data = imageData.data;

        // 创建翻转后的 ImageData
        const flippedData = ctx.createImageData(width, height);
        const flipped = flippedData.data;

        // 垂直翻转：第 y 行变成 height-1-y 行
        for (let y = 0; y < height; y++) {
          const srcRowStart = y * width * 4;
          const dstRowStart = (height - 1 - y) * width * 4;
          for (let x = 0; x < width; x++) {
            const srcIdx = srcRowStart + x * 4;
            const dstIdx = dstRowStart + x * 4;
            flipped[dstIdx] = data[srcIdx]; // R
            flipped[dstIdx + 1] = data[srcIdx + 1]; // G
            flipped[dstIdx + 2] = data[srcIdx + 2]; // B
            flipped[dstIdx + 3] = data[srcIdx + 3]; // A
          }
        }
        // 将翻转后的图像写回画布
        ctx.putImageData(flippedData, 0, 0);

        // 更新 prevFx
        prevFx = fx;
      }

      let imageData, newPosY=0;
      // ======== 正常滚动逻辑开始 ========
      if (fx === false) {
        // 向下滚动：图像上移一行，新行加在顶部
        imageData = ctx.getImageData(0, 0, width, height);
        ctx.putImageData(imageData, 0, 1);
        // 新行绘制在顶部（y=1）
        newPosY=1;
      } else {
        // 向上滚动：图像下移一行，新行加在底部
        imageData = ctx.getImageData(0, 1, width, height);
        ctx.putImageData(imageData, 0, 0);
        // 新行绘制在底部（y=height）
        newPosY=height;
      }

      const newRow = newData1D(ctx, magnitude,width,1);
      // 将新的一行绘制到指定位置（即:newRowY）
      ctx.putImageData(newRow, 0, newPosY-1);
    }

    //提取创建一行or一列频谱的逻辑为独立函数，避免重复
    function newData1D(ctx, magnitude, wX=1, hY=1) {
      if(wX!=1 && hY!=1 || wX==1 && hY==1)
        alert("创建1行/1列频谱,只能`宽或高`其①=1哦");
      
      const totalN=wX*hY; //数据点的个数,两者乘积(因为其中一个必为1)
      const img1D = ctx.createImageData(wX, hY);
      const data = img1D.data;
      //频率的分辨率, 即多少Hz做为1个小刻度
      const freqRes = sampleRate / nFFT;

      for (let i = 0; i < totalN; i++) {
        const freqRatio = i/totalN;
        //对于一行图像数据而言, 此时freq-->x轴数据
        const freq = freqMin + (freqMax - freqMin) * freqRatio;
        const kedu = Math.floor(freq / freqRes);
        
        //图像的值, 包含有4个数(R,G,B,alpha)
        const Val = kedu >= 0 && kedu < magnitude.length ? magnitude[kedu] : -100;
        let norm = (Val - magMin) / (magMax - magMin);
            norm = Math.max(0, Math.min(1, norm));
        const [r, g, b] = getColor(norm);

        const idx = (wX==1?totalN-i:i) * 4;
        data[idx] = r;//红色分量值
        data[idx + 1] = g;
        data[idx + 2] = b;
        data[idx + 3] = 255;
      }

      return img1D;
    }
    
    // ==================== 8. 录音功能 ====================
    let mediaRecorder;
    let recordedBlobs = [];
    let audioStream = null;
    const startBtn = document.getElementById("startRecord");
    const stopBtn = document.getElementById("stopRecord");
    const saveBtn = document.getElementById("saveRecord");
    saveBtn.style.backgroundColor = "#00F"; //蓝色

    // 检查浏览器兼容性
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      alert("当前浏览器不支持录音功能，请升级或更换浏览器");
    }

    // 开始录音
    document.getElementById("startRecord").addEventListener("click", async () => {
      try {
        audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (allowRecord === false) {
          Alert("Record is not allowed now!");
          return;
        }
        recordedBlobs = [];

        // 确定合适的MIME类型
        let mimeType = "audio/webm";
        if (!MediaRecorder.isTypeSupported(mimeType)) {
          mimeType = "audio/ogg";
        }
        if (!MediaRecorder.isTypeSupported(mimeType)) {
          mimeType = "audio/wav";
        }

        mediaRecorder = new MediaRecorder(audioStream, { mimeType });

        // 收集录制的数据块
        mediaRecorder.ondataavailable = (event) => {
          if (event.data && event.data.size > 0) {
            recordedBlobs.push(event.data);
          }
        };

        mediaRecorder.onstop = () => {
          document.getElementById("saveRecord").disabled = false;
        };

        mediaRecorder.start(100);
        //document.getElementById("startRecord").disabled = true;
        //document.getElementById("stopRecord").disabled = false;
        // 暂停按钮变为红色
        stopBtn.style.backgroundColor = "red";
        startBtn.style.backgroundColor = "#555";
        stopBtn.style.color = "yellow";
        startBtn.disabled = true;
        stopBtn.disabled = false;
      } catch (err) {
        handleAudioError(err);
      }
    });

    // 停止录音
    document.getElementById("stopRecord").addEventListener("click", () => {
      if (
        (mediaRecorder && mediaRecorder.state !== "inactive") ||
        allowRecord == false
      ) {
        mediaRecorder.stop();

        // 释放麦克风资源
        if (audioStream) {
          audioStream.getTracks().forEach((track) => track.stop());
          audioStream = null;
        }

        //document.getElementById("startRecord").disabled = false;
        //document.getElementById("stopRecord").disabled = true;
        // 恢复开始按钮为绿色
        // 暂停按钮变为disabled
        startBtn.style.backgroundColor = "#00FF00";
        stopBtn.style.backgroundColor = "#333";
        stopBtn.style.color = "black";
        startBtn.disabled = false;
        stopBtn.disabled = true;
      }
    });

    // 保存录音
    document.getElementById("saveRecord").addEventListener("click", () => {
      if (recordedBlobs.length === 0) {
        alert("没有录音数据可保存。");
        return;
      }

      const mimeType = recordedBlobs[0]?.type || "audio/webm";
      const superBuffer = new Blob(recordedBlobs, { type: mimeType });

      // 确定文件扩展名
      const getExtension = (type) => {
        if (type.includes("webm")) return "webm";
        if (type.includes("ogg")) return "ogg";
        if (type.includes("wav")) return "wav";
        if (type.includes("mp3")) return "mp3";
        return "audio.webm";
      };

      const extension = getExtension(mimeType);
      const fileName = `recording_${new Date()
        .toISOString()
        .slice(0, 19)
        .replace(/:/g, "-")}.${extension}`;
      const url = URL.createObjectURL(superBuffer);

      // 创建下载链接
      const a = document.createElement("a");
      a.style.display = "none";
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();

      // 清理内存
      setTimeout(() => URL.revokeObjectURL(url), 100);
    });

    // 错误处理
    function handleAudioError(err) {
      if (err.name === "NotAllowedError") {
        alert("用户拒绝了麦克风权限，请在设置中开启。");
      } else if (err.name === "NotFoundError") {
        alert("未检测到麦克风设备。");
      } else {
        alert("无法访问麦克风：" + err.message);
      }
      console.error(err);
    }
    
    const recordBar = document.getElementById('floatBar');
    document.addEventListener('DOMContentLoaded', function() {
        //const floatBar = document.getElementById('floatBar');
        // 获取浮动条的尺寸
        const rect = floatBar.getBoundingClientRect();
        // 计算中心点坐标
        const centerX = (window.innerWidth - rect.width) /2;
        const centerY = (window.innerHeight - rect.height)/2;

        floatBar.style.right = `${window.innerWidth*0.66}px`;
        floatBar.style.bottom = `${window.innerHeight*0.66}px`;
        // 设置新的位置--->正中央
        //floatBar.style.right = `${centerX}px`;
        //floatBar.style.bottom = `${centerY}px`;
    });

    let isDragging = false;
    let offsetX, offsetY;

    // 鼠标按下：准备拖动
    recordBar.addEventListener('mousedown', (e) => {
      // 防止点击按钮时也触发拖动（可选优化）
      if (e.target.tagName === 'BUTTON') return;

      isDragging = true;
      const rect = recordBar.getBoundingClientRect();
      offsetX = e.clientX - rect.right;
      offsetY = e.clientY - rect.top;
      recordBar.style.opacity = '0.9'; // 视觉反馈
      e.preventDefault(); // 防止默认行为（如选中文本）
    });

    // 鼠标移动：拖动
    document.addEventListener('mousemove', (e) => {
      if (!isDragging) return;

      const right = window.innerWidth - (e.clientX - offsetX);
      const top = e.clientY - offsetY;

      // 限制边界（防止移出屏幕）
      recordBar.style.right = `${Math.max(right, 10)}px`;
      recordBar.style.bottom = `${window.innerHeight - top - 10}px`;
    });

    // 鼠标释放：结束拖动
    document.addEventListener('mouseup', () => {
      if (isDragging) {
        isDragging = false;
        recordBar.style.opacity = '1';
      }
    });
    
    
    // 启动音频采集
    startAudio();