Template.post.events({

  "submit form": function(e, template){
    e.preventDefault();

    var post = $('textarea');
    var texto = post.val();
  
    if(post.val().length < 1){
       false
    }else{
      var name = Meteor.user().profile.name;
      Meteor.call("addPost",texto, name );
    }

    console.log(texto)
    post.val('')
    post.focus();
  }
});



