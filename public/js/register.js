// 등록 페이지 JavaScript

let uploadedImages = [];

document.addEventListener('DOMContentLoaded', function() {
    // 로그인 상태 확인
    checkLoginStatus();
    
    // 사용자 정보 자동 입력
    fillUserInfo();
    
    // 이미지 파일 선택 이벤트
    setupImageSelection();
    
    // 폼 제출 이벤트
    setupFormSubmission();
});

function checkLoginStatus() {
    if (!isUserLoggedIn()) {
        alert('로그인이 필요합니다.');
        window.location.href = '/login';
        return;
    }
}

function fillUserInfo() {
    const userData = JSON.parse(localStorage.getItem('userInfo') || '{}');
    
    // 사용자 정보를 폼에 자동 입력 (필요시)
    // 현재는 연락처만 입력받도록 함
}

function setupImageSelection() {
    const imageInput = document.getElementById('projectImages');
    const fileNameDisplay = document.getElementById('fileNameDisplay');
    
    imageInput.addEventListener('change', function(e) {
        const files = Array.from(e.target.files);
        
        if (files.length === 0) {
            fileNameDisplay.textContent = '선택된 파일 없음';
            return;
        }
        
        // 파일명 표시 업데이트
        if (files.length === 1) {
            fileNameDisplay.textContent = files[0].name;
        } else {
            fileNameDisplay.textContent = `${files.length}개의 파일 선택됨`;
        }
        
        // 최대 10장 제한
        if (files.length > 10) {
            alert('최대 10장까지만 선택할 수 있습니다.');
            imageInput.value = '';
            fileNameDisplay.textContent = '선택된 파일 없음';
            return;
        }
        
        // 파일 크기 검사 (각 파일 10MB 제한)
        const maxSize = 10 * 1024 * 1024; // 10MB
        const oversizedFiles = files.filter(file => file.size > maxSize);
        
        if (oversizedFiles.length > 0) {
            alert('파일 크기는 10MB를 초과할 수 없습니다.');
            imageInput.value = '';
            fileNameDisplay.textContent = '선택된 파일 없음';
            return;
        }
        
        // 이미지 파일만 허용
        const imageFiles = files.filter(file => file.type.startsWith('image/'));
        if (imageFiles.length !== files.length) {
            alert('이미지 파일만 선택 가능합니다.');
            imageInput.value = '';
            fileNameDisplay.textContent = '선택된 파일 없음';
            return;
        }
        
        // 선택된 파일들을 업로드
        uploadImages(imageFiles);
    });
}

async function uploadImages(files) {
    for (const file of files) {
        await uploadImage(file);
    }
}

async function uploadImage(file) {
    const formData = new FormData();
    formData.append('image', file);
    
    try {
        const token = getUserToken();
        if (!token) {
            throw new Error('인증이 필요합니다.');
        }
        
        const response = await fetch('/api/upload', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`
            },
            body: formData
        });
        
        const result = await response.json();
        
        if (response.ok && result.success) {
            uploadedImages.push(result.imageUrl);
            updateImagePreview();
        } else {
            throw new Error(result.error || '이미지 업로드 실패');
        }
    } catch (error) {
        console.error('이미지 업로드 오류:', error);
        alert('이미지 업로드에 실패했습니다.');
    }
}

function updateImagePreview() {
    const preview = document.getElementById('imagesPreview');
    preview.innerHTML = '';
    
    uploadedImages.forEach((imageUrl, index) => {
        const imageContainer = document.createElement('div');
        imageContainer.className = 'image-preview-item';
        
        // XSS 방지를 위해 안전하게 이미지 추가
        const img = document.createElement('img');
        img.src = escapeHtml(imageUrl);
        img.alt = `업로드된 이미지 ${index + 1}`;
        
        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'remove-image-btn';
        removeBtn.textContent = '×';
        removeBtn.addEventListener('click', () => removeImage(index));
        
        imageContainer.appendChild(img);
        imageContainer.appendChild(removeBtn);
        preview.appendChild(imageContainer);
    });
}

function removeImage(index) {
    uploadedImages.splice(index, 1);
    updateImagePreview();
}

function setupFormSubmission() {
    const form = document.getElementById('registerForm');
    const successMessage = document.getElementById('successMessage');
    
    form.addEventListener('submit', async function(e) {
        e.preventDefault();
        
        // 폼 유효성 검사
        if (!validateForm()) {
            alert('모든 필수 항목을 올바르게 입력해주세요.');
            return;
        }
        
        try {
            // 폼 데이터 수집
            const formData = new FormData(form);
            const projectData = {
                title: formData.get('title'),
                description: formData.get('description'),
                category: formData.get('category'),
                contact: formData.get('contact'),
                project_url: formData.get('project_url') || '',
                image_size: formData.get('image_size') || 'cover',
                detail_description: formData.get('detail_description') || '',
                features: formData.get('features') || '',
                tech_stack: formData.get('tech_stack') || '',
                links: formData.get('links') || '',
                project_images: JSON.stringify(uploadedImages)
            };
            
            // 사용자 정보 추가
            const userData = JSON.parse(localStorage.getItem('userInfo') || '{}');
            projectData.applicant_name = userData.fullName;
            projectData.email = userData.email;
            
            // 데이터베이스에 저장
            await saveToDatabase(projectData);
            
            // 성공 메시지 표시
            form.style.display = 'none';
            successMessage.style.display = 'block';
            
        } catch (error) {
            console.error('등록 실패:', error);
            alert('등록에 실패했습니다. 다시 시도해주세요.');
        }
    });
}

async function saveToDatabase(data) {
    const response = await authenticatedFetch('/api/applications', {
        method: 'POST',
        body: JSON.stringify(data)
    });
    
    const result = await response.json();
    
    if (!response.ok || !result.success) {
        throw new Error(result.error || '데이터베이스 저장 실패');
    }
    
    return result;
}

function validateForm() {
    const requiredFields = ['projectTitle', 'projectDescription', 'category', 'contact'];
    let isValid = true;
    
    requiredFields.forEach(fieldName => {
        const field = document.getElementById(fieldName);
        if (!field || !field.value.trim()) {
            if (field) field.style.borderColor = '#ff6b6b';
            isValid = false;
        } else {
            field.style.borderColor = '#555';
        }
    });
    
    // 연락처 형식 검사
    const contactField = document.getElementById('contact');
    const contactPattern = /^01[0-9]-?[0-9]{4}-?[0-9]{4}$/;
    if (contactField.value && !contactPattern.test(contactField.value.replace(/-/g, ''))) {
        contactField.style.borderColor = '#ff6b6b';
        isValid = false;
    }
    
    return isValid;
}

// 실시간 유효성 검사
document.addEventListener('DOMContentLoaded', function() {
    const inputs = document.querySelectorAll('input, select, textarea');
    inputs.forEach(input => {
        input.addEventListener('blur', function() {
            if (this.hasAttribute('required') && !this.value.trim()) {
                this.style.borderColor = '#ff6b6b';
            } else {
                this.style.borderColor = '#555';
            }
        });
        
        input.addEventListener('input', function() {
            if (this.style.borderColor === 'rgb(255, 107, 107)') {
                this.style.borderColor = '#555';
            }
        });
    });
});