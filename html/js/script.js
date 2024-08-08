document.getElementById('searchForm').addEventListener('submit', async function (e) {
	e.preventDefault();
	const query = document.getElementById('query').value;
	try {
	  const response = await fetch('/stream?query=' + encodeURIComponent(query));
	  if (!response.ok) {
		throw new Error('Search failed: ' + response.statusText);
	  }
	  const data = await response.json();
	  document.getElementById('results').innerHTML = JSON.stringify(data.dbResults);
	  document.getElementById('query').value = ''; // Clear the search input
	} catch (error) {
	  document.getElementById('results').innerHTML = '<div class="error">' + error.message + '</div>';
	}
  });

  document.getElementById('uploadForm').addEventListener('submit', async function (e) {
	e.preventDefault();
	const formData = new FormData();
	formData.append('songFile', document.getElementById('songFile').files[0]);

	const fileName = document.getElementById('songFile').files[0].name;

	try {
	  const response = await fetch('/upload', {
		method: 'POST',
		body: formData
	  });

	  if (!response.ok) {
		throw new Error('Upload failed: ' + response.statusText);
	  }

	  const result = await response.json();
	  document.getElementById('uploadResult').innerHTML = '<div class="success">Upload successful: ' + JSON.stringify(result) + '</div>';

	  if (result.success) {
		const audioPlayer = document.getElementById('audioPlayer');
		audioPlayer.src = '/songs/' + result.metadata.filename;
		audioPlayer.play();
	  }

	  // Clear progress
	  document.getElementById('progressBar').style.width = '0%';
	  document.getElementById('progressBar').innerText = '0%';
	} catch (error) {
	  document.getElementById('uploadResult').innerHTML = '<div class="error">' + error.message + '</div>';
	}
  });

  // Function to update progress bar
  async function updateProgressBar(fileName) {
	const progressContainer = document.getElementById('progressContainer');
	const progressBar = document.getElementById('progressBar');
	while (true) {
	  try {
		const response = await fetch(`/progress/${fileName}`);
		if (!response.ok) {
		  throw new Error('Failed to get progress: ' + response.statusText);
		}
		const data = await response.json();
		const progress = data.progress;
		progressBar.style.width = progress + '%';
		progressBar.innerText = progress + '%';
		if (progress >= 100) break;
	  } catch (error) {
		progressBar.innerText = 'Error';
		break;
	  }
	  await new Promise(resolve => setTimeout(resolve, 1000)); // Wait for 1 second
	}
  }

  document.getElementById('songFile').addEventListener('change', function (e) {
	const fileName = e.target.files[0].name;
	updateProgressBar(fileName);
  });
