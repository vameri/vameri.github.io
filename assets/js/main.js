;(function(){
    "use strict";

    var comment = document.getElementById('btn-comments');

	comment.addEventListener('click', function(){
		document.getElementById('comments').style.display = 'block';
		window.scrollTo(0,document.body.scrollHeight);
		return false;
	});

})();