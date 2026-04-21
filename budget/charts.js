const Charts = {
  _instances: {},

  _destroy(id) {
    if (this._instances[id]) {
      this._instances[id].destroy();
      delete this._instances[id];
    }
  },

  renderCategory(canvasId, data) {
    this._destroy(canvasId);
    const canvas = document.getElementById(canvasId);
    if (!canvas || !data.length) return;
    this._instances[canvasId] = new Chart(canvas, {
      type: 'doughnut',
      data: {
        labels: data.map(d => d.name),
        datasets: [{
          data: data.map(d => d.total),
          backgroundColor: data.map(d => d.color),
          borderWidth: 2,
          borderColor: '#16213e',
          hoverOffset: 8,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '65%',
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: ctx => ` CHF ${ctx.parsed.toFixed(2)} (${data[ctx.dataIndex].percent}%)`,
            },
          },
        },
      },
    });
  },

  renderTime(canvasId, { labels, expData, incData }) {
    this._destroy(canvasId);
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const datasets = [{
      label: 'Expenses',
      data: expData,
      backgroundColor: 'rgba(233,69,96,0.75)',
      borderColor: '#e94560',
      borderWidth: 1,
      borderRadius: 3,
    }];
    if (incData && incData.some(v => v > 0)) {
      datasets.push({
        label: 'Income',
        data: incData,
        backgroundColor: 'rgba(76,175,80,0.75)',
        borderColor: '#4CAF50',
        borderWidth: 1,
        borderRadius: 3,
      });
    }
    this._instances[canvasId] = new Chart(canvas, {
      type: 'bar',
      data: { labels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            display: datasets.length > 1,
            labels: { color: '#a8a8b3', boxWidth: 12, font: { size: 11 } },
          },
          tooltip: { callbacks: { label: ctx => ` CHF ${ctx.parsed.y.toFixed(2)}` } },
        },
        scales: {
          x: { ticks: { color: '#a8a8b3', font: { size: 11 } }, grid: { color: 'rgba(255,255,255,0.05)' } },
          y: { beginAtZero: true, ticks: { color: '#a8a8b3', font: { size: 11 } }, grid: { color: 'rgba(255,255,255,0.05)' } },
        },
      },
    });
  },

  renderWeekday(canvasId, { labels, data }) {
    this._destroy(canvasId);
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    this._instances[canvasId] = new Chart(canvas, {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          data,
          backgroundColor: labels.map((_, i) => i >= 5 ? 'rgba(233,69,96,0.8)' : 'rgba(33,150,243,0.75)'),
          borderWidth: 0,
          borderRadius: 4,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: ctx => ` avg CHF ${ctx.parsed.y.toFixed(2)}` } },
        },
        scales: {
          x: { ticks: { color: '#a8a8b3', font: { size: 12 } }, grid: { display: false } },
          y: { beginAtZero: true, ticks: { color: '#a8a8b3', font: { size: 11 } }, grid: { color: 'rgba(255,255,255,0.05)' } },
        },
      },
    });
  },
};
