// Theme toggle
const themeToggle = document.querySelector('.theme-toggle');
const body = document.body;

themeToggle.addEventListener('click', () => {
    body.classList.toggle('light-theme');
    body.classList.toggle('dark-theme');
    if (body.classList.contains('dark-theme')) {
        themeToggle.textContent = 'Переключить на светлую тему';
        themeToggle.classList.add('dark');
    } else {
        themeToggle.textContent = 'Переключить на темную тему';
        themeToggle.classList.remove('dark');
    }
});

// Audio player controls
const audio = document.getElementById('audio-player');
const playPauseBtn = document.getElementById('play-pause');
const seekBar = document.getElementById('seek-bar');
const volumeBar = document.getElementById('volume-bar');
const timeDisplay = document.getElementById('time-display');
const volumeIconBtn = document.getElementById('volume-icon');
const playIcon = '<i class="fas fa-play"></i>';
const pauseIcon = '<i class="fas fa-pause"></i>';
const volumeUpIcon = '<i class="fas fa-volume-up"></i>';
const volumeMuteIcon = '<i class="fas fa-volume-mute"></i>';

let isMuted = false;
let previousVolume = 0.50; // Начальная громкость 50%

// Устанавливаем начальную громкость на 50%
audio.volume = previousVolume;
volumeBar.value = previousVolume * 100;

playPauseBtn.addEventListener('click', () => {
    if (audio.paused) {
        audio.play();
        playPauseBtn.innerHTML = pauseIcon;
    } else {
        audio.pause();
        playPauseBtn.innerHTML = playIcon;
    }
});

// Смена иконки на play при завершении аудио
audio.addEventListener('ended', () => {
    playPauseBtn.innerHTML = playIcon;
});

audio.addEventListener('timeupdate', () => {
    const value = (100 / audio.duration) * audio.currentTime;
    seekBar.value = value;

    const currentMinutes = Math.floor(audio.currentTime / 60);
    const currentSeconds = Math.floor(audio.currentTime - currentMinutes * 60);
    const durationMinutes = Math.floor(audio.duration / 60);
    const durationSeconds = Math.floor(audio.duration - durationMinutes * 60);

    const formatTime = (minutes, seconds) => {
        return `${minutes < 10 ? '0' : ''}${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
    };

    timeDisplay.textContent = `${formatTime(currentMinutes, currentSeconds)} / ${formatTime(durationMinutes, durationSeconds)}`;
});

seekBar.addEventListener('input', () => {
    const time = (seekBar.value / 100) * audio.duration;
    audio.currentTime = time;
});

volumeBar.addEventListener('input', () => {
    audio.volume = volumeBar.value / 100;
    if (audio.volume === 0) {
        volumeIconBtn.innerHTML = volumeMuteIcon;
    } else {
        volumeIconBtn.innerHTML = volumeUpIcon;
    }
});

volumeIconBtn.addEventListener('click', () => {
    if (isMuted) {
        audio.volume = previousVolume;
        volumeBar.value = previousVolume * 100;
        volumeIconBtn.innerHTML = volumeUpIcon;
    } else {
        previousVolume = audio.volume;
        audio.volume = 0;
        volumeBar.value = 0;
        volumeIconBtn.innerHTML = volumeMuteIcon;
    }
    isMuted = !isMuted;
});

audio.addEventListener('loadedmetadata', () => {
    const durationMinutes = Math.floor(audio.duration / 60);
    const durationSeconds = Math.floor(audio.duration - durationMinutes * 60);
    timeDisplay.textContent = `00:00 / ${formatTime(durationMinutes, durationSeconds)}`;
});

function formatTime(minutes, seconds) {
    return `${minutes < 10 ? '0' : ''}${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
}

// Показать длительность при загрузке страницы
window.addEventListener('load', () => {
    if (audio.readyState >= 1) {
        const durationMinutes = Math.floor(audio.duration / 60);
        const durationSeconds = Math.floor(audio.duration - durationMinutes * 60);
        timeDisplay.textContent = `00:00 / ${formatTime(durationMinutes, durationSeconds)}`;
    }
});