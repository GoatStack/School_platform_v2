// 테마 전환 기능

const THEME_KEY = 'theme';
const LIGHT_THEME = 'light';
const DARK_THEME = 'dark';

// 테마 초기화
function initTheme() {
    const savedTheme = localStorage.getItem(THEME_KEY) || DARK_THEME;
    setTheme(savedTheme);
}

// 테마 설정
function setTheme(theme) {
    const body = document.body;
    const html = document.documentElement;
    const themeIcon = document.getElementById('themeIcon');
    
    if (theme === LIGHT_THEME) {
        body.classList.add('light-mode');
        html.classList.add('light-mode');
        if (themeIcon) themeIcon.textContent = '☀';
        localStorage.setItem(THEME_KEY, LIGHT_THEME);
    } else {
        body.classList.remove('light-mode');
        html.classList.remove('light-mode');
        if (themeIcon) themeIcon.textContent = '☽';
        localStorage.setItem(THEME_KEY, DARK_THEME);
    }
}

// 테마 토글
function toggleTheme() {
    const currentTheme = localStorage.getItem(THEME_KEY) || DARK_THEME;
    const newTheme = currentTheme === DARK_THEME ? LIGHT_THEME : DARK_THEME;
    setTheme(newTheme);
}

// 페이지 로드 시 테마 적용
document.addEventListener('DOMContentLoaded', function() {
    initTheme();
    
    // 테마 토글 버튼 이벤트
    const themeToggle = document.getElementById('themeToggle');
    if (themeToggle) {
        themeToggle.addEventListener('click', toggleTheme);
    }
});

